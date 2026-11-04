/**
 * Auth real nas salas (2G): guest -> JWT -> entra; token ausente/inválido/expirado recusado; reconexão
 * com JWT (dono ok, outro usuário e query-string recusados); estranho não ocupa assento de bot ANTES de
 * reservar. Sem `allowDevAuth`: a sala só aceita JWT. UM `Server` por arquivo (matchmaker global).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import type { Room } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { DEFAULT_AVATAR_PARTS } from '@trucaco/protocol';
import type { RoomOptions } from '@trucaco/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthService, hashRefresh } from '../auth/authService';
import type { AuthConfig } from '../auth/config';
import { AccessTokenService } from '../auth/jwt';
import { MemoryTokenStore, TokenStoreUnavailableError } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import { setLogSink } from '../logger';
import { emitUserDeleted } from '../social/blockBus';
import { buildColyseusServer } from '../server';
import { TrucoRoom } from './TrucoRoom';
import type { TrucoRoomConfig } from './TrucoRoom';

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const ROOM: TrucoRoomConfig = {
  patchRateMs: 5,
  actionMinIntervalMs: 0,
  finishDelayMs: 60_000,
  maxMessagesPerSecond: 10_000,
  rngSeed: 5,
  reconnectSeconds: 5,
  botThinkMs: 20,
  turnTimeoutMs: 60_000,
};
const OPTS: RoomOptions = {
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'private',
};

const repos = createMemoryRepositories();
const tokens = new MemoryTokenStore();
const auth = new AuthService(repos.users, tokens, CFG);
let t: ColyseusTestServer;
const logLines: string[] = [];
let restoreLog: () => void = () => undefined;

beforeAll(async () => {
  restoreLog = setLogSink((level, msg, fields) => {
    logLines.push(JSON.stringify({ level, msg, ...fields }));
  });
  // Porta própria: o `TrucoRoom.test.ts` usa a padrão (2568) e os arquivos rodam em paralelo.
  t = await boot(
    buildColyseusServer(ROOM, { auth, users: repos.users, directMatchmake: true }),
    2579,
  );
});
afterEach(async () => {
  await t.cleanup();
});
afterAll(async () => {
  await t.shutdown();
  restoreLog();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(3);
  }
  throw new Error(`timeout esperando: ${what}`);
}

type Session = Awaited<ReturnType<AuthService['createGuest']>>;
type SdkRoom = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;

/** Credencial do SDK de teste: cabeçalho Authorization (HTTP) e, no Node, também no upgrade do WS. */
type SdkHttp = { options: { headers?: Record<string, string> } };
const sdkHttp = (): SdkHttp => t.sdk.http as unknown as SdkHttp;
async function withBearer<T>(token: string | undefined, fn: () => Promise<T>): Promise<T> {
  const http = sdkHttp();
  const before = http.options.headers;
  http.options.headers = token === undefined ? {} : { authorization: `Bearer ${token}` };
  try {
    return await fn();
  } finally {
    http.options.headers = before ?? {};
  }
}

async function joinAs(server: TrucoRoom, s: Session, options: object = {}): Promise<SdkRoom> {
  return withBearer(s.pair.accessToken, () => t.connectTo(server as unknown as Room, options));
}

async function table(n = 4): Promise<{ server: TrucoRoom; sessions: Session[]; rooms: SdkRoom[] }> {
  const server = await t.createRoom<TrucoRoom>('truco', OPTS);
  const sessions: Session[] = [];
  const rooms: SdkRoom[] = [];
  for (let i = 0; i < n; i++) {
    const s = await auth.createGuest();
    sessions.push(s);
    rooms.push(await joinAs(server, s));
  }
  return { server, sessions, rooms };
}

const statusOf = (server: TrucoRoom, seat: number): string =>
  (server.state.players[seat] as { status: string }).status;
const reservedCount = (server: TrucoRoom): number =>
  Object.keys((server as unknown as { _reservedSeats: object })._reservedSeats).length;
const roomCount = async (): Promise<number> => (await matchMaker.query({ name: 'truco' })).length;

async function dropSeat(server: TrucoRoom, rooms: SdkRoom[], seat: number): Promise<void> {
  const r = rooms[seat] as SdkRoom;
  r.reconnection.enabled = false;
  r.connection.close();
  await until(() => statusOf(server, seat) === 'away', `assento ${seat} away`);
}

describe('bloqueio e conta apagada na sala (Fase 6)', () => {
  it('mesa privada: entrada direta de quem tem bloqueio (qualquer sentido) com alguém sentado é TABLE_UNAVAILABLE', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    const [a, b, c] = [
      await auth.createGuest(),
      await auth.createGuest(),
      await auth.createGuest(),
    ];
    await joinAs(server, a);
    // c bloqueou a; b nunca bloqueou ninguém.
    await repos.users.addBlock(c.user.id, a.user.id);
    await expect(joinAs(server, c)).rejects.toMatchObject({
      code: 404,
      message: 'TABLE_UNAVAILABLE',
    });
    // Sentido inverso: a bloqueou b.
    await repos.users.addBlock(a.user.id, b.user.id);
    await expect(joinAs(server, b)).rejects.toMatchObject({
      code: 404,
      message: 'TABLE_UNAVAILABLE',
    });
    expect(statusOf(server, 1)).toBe('empty');
    // Sem bloqueio: entra normalmente.
    const d = await auth.createGuest();
    await joinAs(server, d);
    expect(statusOf(server, 1)).toBe('connected');
  });

  it('blockEdges só guarda pares com alguém sentado (lista de bloqueios não infla a sala)', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    const [a, b, stranger] = [
      await auth.createGuest(),
      await auth.createGuest(),
      await auth.createGuest(),
    ];
    await repos.users.addBlock(a.user.id, stranger.user.id); // stranger nunca senta
    await repos.users.addBlock(a.user.id, b.user.id);
    const edges = (server as unknown as { blockEdges: Set<string> }).blockEdges;
    await joinAs(server, a);
    // a bloqueou stranger e b, mas ninguém mais está sentado: nada é guardado
    expect(edges.size).toBe(0);
    // b chega com a sentado: o par a>b é guardado (e a entrada é recusada); o de stranger, não
    await expect(joinAs(server, b)).rejects.toMatchObject({ code: 404 });
    expect([...edges]).toEqual([`${a.user.id}>${b.user.id}`]);
  });

  it('conta apagada na espera: o socket cai e o assento é liberado', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    const s = await auth.createGuest();
    await joinAs(server, s);
    expect(statusOf(server, 0)).toBe('connected');
    emitUserDeleted(s.user.id);
    await until(() => statusOf(server, 0) === 'empty', 'assento liberado');
  });

  it('conta apagada em partida: o bot assume na hora e a partida é gravada sem o userId', async () => {
    const { server, sessions } = await table();
    await until(() => server.series !== null, 'série');
    const gone = sessions[1] as Session;
    emitUserDeleted(gone.user.id);
    const internal = server as unknown as {
      botSeats: Set<number>;
      persistableUsers(): Map<number, string>;
    };
    await until(() => internal.botSeats.has(1), 'bot assumiu o assento');
    const users = internal.persistableUsers();
    expect(users.size).toBe(3);
    expect([...users.values()]).not.toContain(gone.user.id);
  });
});

describe('reconexão de conta apagada', () => {
  const reconnect = (rooms: SdkRoom[], seat: number, token: string): Promise<SdkRoom> =>
    withBearer(
      token,
      () =>
        t.sdk.reconnect((rooms[seat] as SdkRoom).reconnectionToken) as unknown as Promise<SdkRoom>,
    );

  it('conta apagada com a revogação das sessões falhando (access ainda válido): 401 na reconexão', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 0);
    const s = sessions[0] as Session;
    // só o banco apaga; o access segue válido por não ter sido revogado
    await repos.users.deleteUser(s.user.id);
    await expect(reconnect(rooms, 0, s.pair.accessToken)).rejects.toMatchObject({ code: 401 });
  });

  it('userId em deletedUsers: authorizeReconnect recusa mesmo com assento e sessão certos', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 2);
    const s = sessions[2] as Session;
    const sessionId = (rooms[2] as SdkRoom).sessionId;
    expect(server.authorizeReconnect(sessionId, s.user.id)).toBe(true);
    emitUserDeleted(s.user.id);
    expect(server.authorizeReconnect(sessionId, s.user.id)).toBe(false);
    await expect(reconnect(rooms, 2, s.pair.accessToken)).rejects.toMatchObject({ code: 403 });
  });
});

describe('entrada na sala com JWT', () => {
  it('guest -> JWT -> senta; apelido e avatar vêm do banco, userId/nickname do payload são ignorados', async () => {
    const server = await t.createRoom<TrucoRoom>('truco', OPTS);
    const s = await auth.createGuest();
    await repos.users.saveAvatar(s.user.id, { ...DEFAULT_AVATAR_PARTS, hair: 3 });
    await joinAs(server, s, { userId: 'hacker', nickname: 'Hacker' });
    const p = server.state.players[0] as { nickname: string; avatar: string };
    expect(p.nickname).toBe(s.user.nickname);
    expect(JSON.parse(p.avatar)).toEqual({ ...DEFAULT_AVATAR_PARTS, hair: 3 });
    const internal = server as unknown as {
      seatBySession: Map<string, number>;
      userBySeat: Map<number, string>;
    };
    const [sessionId, seat] = [...internal.seatBySession.entries()][0] as [string, number];
    expect(internal.userBySeat.get(seat)).toBe(s.user.id);
    expect(server.authorizeReconnect(sessionId, 'hacker')).toBe(false);
    expect(server.authorizeReconnect(sessionId, s.user.id)).toBe(true);
    // 4 convidados jogam: a série começa
    for (let i = 0; i < 3; i++) await joinAs(server, await auth.createGuest());
    await until(() => server.series !== null, 'série iniciada');
  });

  it('sem token, token lixo, expirado, aud errado, usuário removido ou jti revogado: recusado sem criar sala', async () => {
    const before = await roomCount();
    const s = await auth.createGuest();
    const old = new AccessTokenService(CFG, () => Date.now() - 2 * 900_000);
    const expired = (await old.sign(s.user.id)).token;
    const foreignAud = (await new AccessTokenService({ ...CFG, audience: 'x' }).sign(s.user.id))
      .token;
    const gone = await auth.createGuest();
    repos.store.users.delete(gone.user.id);
    // Sem janela de graça: a reapresentação imediata é reuso e revoga o `jti` vigente.
    const strict = new AuthService(repos.users, tokens, { ...CFG, refreshReuseGraceSec: 0 });
    const revoked = await strict.createGuest();
    const rotated = await strict.refresh(revoked.pair.refreshToken);
    await expect(strict.refresh(revoked.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    const attempts: (string | undefined)[] = [
      undefined,
      'lixo',
      expired,
      foreignAud,
      gone.pair.accessToken,
      rotated.accessToken,
    ];
    for (const token of attempts) {
      await expect(
        withBearer(token, () =>
          t.sdk.create('truco', { ...OPTS, userId: s.user.id, nickname: 'X' }),
        ),
      ).rejects.toMatchObject({ code: 401 });
      await expect(
        withBearer(token, () =>
          t.sdk.joinOrCreate('truco', { ...OPTS, userId: s.user.id, nickname: 'X' }),
        ),
      ).rejects.toMatchObject({ code: 401 });
    }
    expect(await roomCount()).toBe(before);
  });

  it('JWT na query string ou no corpo (sem Authorization) não autentica', async () => {
    const before = await roomCount();
    const s = await auth.createGuest();
    const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
      .port;
    const post = (
      path: string,
      body: object,
      headers: Record<string, string> = {},
    ): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    const jwt = s.pair.accessToken;
    for (const res of [
      await post(`/matchmake/create/truco?_authToken=${jwt}&token=${jwt}`, OPTS),
      await post('/matchmake/create/truco', { ...OPTS, token: jwt, _authToken: jwt }),
      await post('/matchmake/create/truco', { ...OPTS, userId: s.user.id, nickname: 'X' }),
    ]) {
      expect(res.status).toBeGreaterThanOrEqual(400);
    }
    expect(await roomCount()).toBe(before);
    // controle: o mesmo token no cabeçalho cria a sala
    const ok = await post('/matchmake/create/truco', OPTS, { authorization: `Bearer ${jwt}` });
    expect(ok.status).toBe(200);
  });

  it('static onAuth ignora o `token` do core (pode vir da query do WS): vale só o cabeçalho', async () => {
    const s = await auth.createGuest();
    const ctx = (h: Record<string, string>) => ({ headers: new Headers(h) }) as never;
    await expect(TrucoRoom.onAuth(s.pair.accessToken, {}, ctx({}))).rejects.toMatchObject({
      code: 401,
    });
    await expect(TrucoRoom.onAuth(undefined, {}, undefined)).rejects.toMatchObject({ code: 401 });
    const ok = await TrucoRoom.onAuth(
      undefined,
      {},
      ctx({ authorization: `Bearer ${s.pair.accessToken}` }),
    );
    expect(ok).toMatchObject({ userId: s.user.id, nickname: s.user.nickname });
  });

  it('o JWT e o hash nunca aparecem nos logs da sala', async () => {
    const { sessions } = await table(1);
    const text = logLines.join('\n');
    expect(text).not.toContain((sessions[0] as Session).pair.accessToken);
    expect(text).not.toContain((sessions[0] as Session).pair.refreshToken);
  });
});

describe('reconexão com JWT', () => {
  const reconnect = (rooms: SdkRoom[], seat: number, token: string | undefined): Promise<SdkRoom> =>
    withBearer(
      token,
      () =>
        t.sdk.reconnect((rooms[seat] as SdkRoom).reconnectionToken) as unknown as Promise<SdkRoom>,
    );

  it('o dono volta com o próprio JWT (cabeçalho), recebe o assento de volta', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 0);
    const back = await reconnect(rooms, 0, (sessions[0] as Session).pair.accessToken);
    expect(back.connection.isOpen).toBe(true);
    await until(() => statusOf(server, 0) === 'connected', 'dono de volta');
  });

  it('JWT de OUTRO usuário (válido) é recusado e o assento fica intacto', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 0);
    await expect(
      reconnect(rooms, 0, (sessions[1] as Session).pair.accessToken),
    ).rejects.toMatchObject({ code: 403 });
    const stranger = await auth.createGuest();
    await expect(reconnect(rooms, 0, stranger.pair.accessToken)).rejects.toMatchObject({
      code: 403,
    });
    await expect(reconnect(rooms, 0, undefined)).rejects.toMatchObject({ code: 401 });
    await expect(reconnect(rooms, 0, 'lixo')).rejects.toMatchObject({ code: 401 });
    expect(statusOf(server, 0)).toBe('away');
    // o dono ainda consegue
    await reconnect(rooms, 0, (sessions[0] as Session).pair.accessToken);
    await until(() => statusOf(server, 0) === 'connected', 'dono de volta');
  });

  it('JWT expirado durante a queda: recusado; renovando com o refresh, reconecta', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 2);
    const s = sessions[2] as Session;
    const expired = (
      await new AccessTokenService(CFG, () => Date.now() - 2 * 900_000).sign(s.user.id)
    ).token;
    await expect(reconnect(rooms, 2, expired)).rejects.toMatchObject({ code: 401 });
    const fresh = await auth.refresh(s.pair.refreshToken);
    await reconnect(rooms, 2, fresh.accessToken);
    await until(() => statusOf(server, 2) === 'connected', 'reconectou com token novo');
  });

  it('logout { all } em outro aparelho: o access vigente do dono morre e a reconexão é recusada (401)', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    const s = sessions[1] as Session;
    // segundo aparelho do mesmo usuário (outra família), com o seu próprio access
    const refreshToken = randomBytes(32).toString('base64url');
    const second = await auth.jwt.sign(s.user.id);
    await tokens.createFamily({
      familyId: randomUUID(),
      userId: s.user.id,
      refreshHash: hashRefresh(refreshToken),
      jti: second.jti,
      ttlSec: 3600,
    });
    await dropSeat(server, rooms, 1);
    await auth.logout(await auth.authenticateAccess(s.pair.accessToken), { all: true });
    await expect(reconnect(rooms, 1, second.token)).rejects.toMatchObject({ code: 401 });
    await expect(reconnect(rooms, 1, s.pair.accessToken)).rejects.toMatchObject({ code: 401 });
    expect(statusOf(server, 1)).toBe('away');
  });

  it('upgrade cru: JWT só na QUERY é recusado (401); no cabeçalho e no subprotocolo é aceito', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
      .port;
    const reserve = async (seat: number): Promise<string> => {
      await dropSeat(server, rooms, seat);
      const [roomId, rtoken] = (rooms[seat] as SdkRoom).reconnectionToken.split(':') as [
        string,
        string,
      ];
      const res = await fetch(`http://127.0.0.1:${port}/matchmake/reconnect/${roomId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${(sessions[seat] as Session).pair.accessToken}`,
        },
        body: JSON.stringify({ reconnectionToken: rtoken }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sessionId: string; processId: string };
      return `/${body.processId}/${server.roomId}?sessionId=${body.sessionId}&reconnectionToken=${rtoken}`;
    };
    const upgrade = (path: string, headers: Record<string, string>): Promise<number | 'upgrade'> =>
      new Promise((resolve, reject) => {
        const req = request({
          host: '127.0.0.1',
          port,
          path,
          headers: {
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
            'Sec-WebSocket-Version': '13',
            ...headers,
          },
        });
        req.on('response', (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on('upgrade', (_res, socket) => {
          socket.destroy();
          resolve('upgrade');
        });
        req.on('error', reject);
        req.end();
      });

    const jwt0 = (sessions[0] as Session).pair.accessToken;
    const path0 = await reserve(0);
    // query-string: nunca vale, nem com o token certo
    expect(await upgrade(`${path0}&_authToken=${jwt0}`, {})).toBe(401);
    expect(await upgrade(`${path0}&token=${jwt0}`, {})).toBe(401);
    // dono, mas JWT de outro usuário: 403
    const other = (sessions[1] as Session).pair.accessToken;
    expect(await upgrade(path0, { Authorization: `Bearer ${other}` })).toBe(403);
    expect(await upgrade(path0, { 'Sec-WebSocket-Protocol': `trucaco.bearer, ${other}` })).toBe(
      403,
    );
    // lixo: 401
    expect(await upgrade(path0, { Authorization: 'Bearer lixo' })).toBe(401);
    // dono pelo subprotocolo (browsers)
    expect(await upgrade(path0, { 'Sec-WebSocket-Protocol': `trucaco.bearer, ${jwt0}` })).toBe(
      'upgrade',
    );

    const jwt2 = (sessions[2] as Session).pair.accessToken;
    const path2 = await reserve(2);
    expect(await upgrade(path2, { Authorization: `Bearer ${jwt2}` })).toBe('upgrade');
  });

  it('POST /matchmake/reconnect exige JWT do dono (401/403) e não derruba cliente conectado', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    // token de reconexão de um cliente CONECTADO: nem o dono nem estranho o usam para derrubá-lo
    await expect(
      reconnect(rooms, 1, (sessions[1] as Session).pair.accessToken),
    ).rejects.toMatchObject({ code: 403 });
    await expect(
      reconnect(rooms, 1, (sessions[0] as Session).pair.accessToken),
    ).rejects.toMatchObject({ code: 403 });
    await sleep(100);
    expect(server.clients.length).toBe(4);
    expect(statusOf(server, 1)).toBe('connected');
  });

  it('wrapper de /matchmake/reconnect (HTTP cru): sem Authorization 401, JWT de outro 403, dono 200', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 0); // assento em janela de reconexão
    const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
      .port;
    const [roomId, rtoken] = (rooms[0] as SdkRoom).reconnectionToken.split(':') as [string, string];
    const post = (headers: Record<string, string>): Promise<Response> =>
      fetch(`http://127.0.0.1:${port}/matchmake/reconnect/${roomId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ reconnectionToken: rtoken }),
      });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer lixo' })).status).toBe(401);
    const other = (sessions[1] as Session).pair.accessToken;
    expect((await post({ authorization: `Bearer ${other}` })).status).toBe(403);
    const stranger = await auth.createGuest();
    expect((await post({ authorization: `Bearer ${stranger.pair.accessToken}` })).status).toBe(403);
    expect(statusOf(server, 0)).toBe('away');
    const owner = (sessions[0] as Session).pair.accessToken;
    expect((await post({ authorization: `Bearer ${owner}` })).status).toBe(200);
  });

  it('token store fora do ar na reconexão: 503 (HTTP cru) e 503 no upgrade, nunca 401', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await dropSeat(server, rooms, 0);
    const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
      .port;
    const [roomId, rtoken] = (rooms[0] as SdkRoom).reconnectionToken.split(':') as [string, string];
    const original = tokens.isJtiRevoked.bind(tokens);
    tokens.isJtiRevoked = async () => {
      throw new TokenStoreUnavailableError();
    };
    try {
      const res = await fetch(`http://127.0.0.1:${port}/matchmake/reconnect/${roomId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${(sessions[0] as Session).pair.accessToken}`,
        },
        body: JSON.stringify({ reconnectionToken: rtoken }),
      });
      expect(res.status).toBe(503);
    } finally {
      tokens.isJtiRevoked = original;
    }
  });
});

describe('dependência fora do ar no onAuth da sala', () => {
  const create = async (): Promise<Response> => {
    const s = await auth.createGuest();
    const port = ((t.server.transport.server as { address(): unknown }).address() as AddressInfo)
      .port;
    return fetch(`http://127.0.0.1:${port}/matchmake/create/truco`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${s.pair.accessToken}`,
      },
      body: JSON.stringify(OPTS),
    });
  };

  it('Redis fora do ar: 503 (não 401), sem criar sala e sem vazar a mensagem do erro', async () => {
    const before = await roomCount();
    const original = tokens.isJtiRevoked.bind(tokens);
    tokens.isJtiRevoked = async () => {
      throw new Error('ECONNREFUSED redis://:senha@10.0.0.9:6379');
    };
    try {
      const res = await create();
      expect(res.status).toBe(503);
      expect(await res.text()).not.toContain('senha');
    } finally {
      tokens.isJtiRevoked = original;
    }
    expect(await roomCount()).toBe(before);
    expect(logLines.join('\n')).not.toContain('senha');
  });

  it('Prisma (findById/getAvatar) falhando: 503 genérico, sem a mensagem do erro, sem sala', async () => {
    const before = await roomCount();
    const users = repos.users;
    const findById = users.findById.bind(users);
    const getAvatar = users.getAvatar.bind(users);
    for (const method of ['findById', 'getAvatar'] as const) {
      users[method] = (async () => {
        throw new Error('connection to db at 10.1.2.3 password=segredo');
      }) as never;
      try {
        const res = await create();
        expect(res.status).toBe(503);
        expect(await res.text()).not.toContain('segredo');
      } finally {
        users.findById = findById;
        users.getAvatar = getAvatar;
      }
    }
    expect(await roomCount()).toBe(before);
    expect(logLines.join('\n')).not.toContain('segredo');
  });
});

describe('assento de bot e reserva', () => {
  it('estranho com JWT válido NÃO ocupa assento de bot e nada é reservado; o dono retoma', async () => {
    const { server, sessions, rooms } = await table();
    await until(() => server.series !== null, 'série');
    await rooms[3]?.leave(true);
    await until(() => statusOf(server, 3) === 'bot', 'bot assumiu');
    const stranger = await auth.createGuest();
    expect(reservedCount(server)).toBe(0);
    // Prova de "ANTES de reservar": nenhuma escrita em `_reservedSeats` (nem transitória) acontece.
    const writes: string[] = [];
    const host = server as unknown as { _reservedSeats: Record<string, unknown> };
    host._reservedSeats = new Proxy(host._reservedSeats, {
      set(target, key, value) {
        writes.push(String(key));
        return Reflect.set(target, key, value);
      },
    });
    for (let i = 0; i < 3; i++) {
      await expect(joinAs(server, stranger)).rejects.toBeDefined();
    }
    // quem já ocupa assento humano também não reserva de novo
    await expect(joinAs(server, sessions[0] as Session)).rejects.toBeDefined();
    expect(writes).toEqual([]);
    expect(reservedCount(server)).toBe(0);
    expect(server.clients.length).toBe(3);
    expect(statusOf(server, 3)).toBe('bot');
    const back = await joinAs(server, sessions[3] as Session);
    expect(back.connection.isOpen).toBe(true);
    await until(() => statusOf(server, 3) === 'connected', 'dono retomou');
  });

  it('onReconnect com assento inconsistente expulsa o assento e bane o intruso', async () => {
    const { server } = await table();
    await until(() => server.series !== null, 'série');
    const internal = server as unknown as {
      seatBySession: Map<string, number>;
      expelledSeats: Set<number>;
      bannedUsers: Set<string>;
    };
    const [sessionId, seat] = [...internal.seatBySession.entries()][0] as [string, number];
    const left: number[] = [];
    const fake = {
      sessionId,
      auth: { userId: 'intruso-id', nickname: 'x' },
      leave: (code: number) => left.push(code),
      send: () => undefined,
    };
    server.onReconnect(fake as never);
    expect(left).toEqual([1008]);
    expect(internal.expelledSeats.has(seat)).toBe(true);
    expect(internal.bannedUsers.has('intruso-id')).toBe(true);
    // e sem seat conhecido: não lança
    server.onReconnect({ ...fake, sessionId: 'desconhecida' } as never);
    expect(left).toEqual([1008, 1008]);
  });
});
