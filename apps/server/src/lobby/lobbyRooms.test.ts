/**
 * Lobby + persistência de ponta a ponta (bloco 2H): 4 convidados reais (`/auth/guest` -> JWT), mesa privada
 * por código, fila pública, partida jogada até o fim pela própria sala (turnos de 15 ms), registro em
 * memória conferido campo a campo. UM `Server` por arquivo (matchmaker global).
 */
import type { AddressInfo } from 'node:net';
import { matchMaker } from '@colyseus/core';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import type { RoomOptions } from '@trucaco/protocol';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import type { AuthConfig } from '../auth/config';
import { MemoryTokenStore } from '../auth/tokenStore';
import { createMemoryRepositories, PersistenceError } from '../db';
import type { FinishedMatchInput, MatchRepository } from '../db';
import { setLogSink } from '../logger';
import { TrucoRoom } from '../rooms/TrucoRoom';
import type { TrucoRoomConfig } from '../rooms/TrucoRoom';
import { buildColyseusServer } from '../server';
import { leakViolations } from '../game/leakdetect';
import type { RefHolder } from '../game/leakdetect';
import { getLobby } from './lobby';
import type { Grant } from './lobby';

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
  finishDelayMs: 250,
  maxMessagesPerSecond: 10_000,
  rngSeed: 7,
  reconnectSeconds: 1,
  botThinkMs: 5,
  turnTimeoutMs: 15,
  // 9 x 9: a série acaba em poucas mãos.
  initialScores: [9, 9],
};
const PRIV: RoomOptions = {
  variant: 'paulista',
  format: 'single',
  ironHand: false,
  visibility: 'private',
};
const PUB: RoomOptions = { ...PRIV, visibility: 'public' };

const repos = createMemoryRepositories();
const tokens = new MemoryTokenStore();
const auth = new AuthService(repos.users, tokens, CFG);
let impl: MatchRepository = repos.matches;
// Troca a implementação por teste (falha do banco), sem religar o servidor.
const matchesProxy: MatchRepository = {
  saveMatch: (input) => impl.saveMatch(input),
  listForUser: (u, o) => impl.listForUser(u, o),
};
let t: ColyseusTestServer;
const logLines: string[] = [];
let restoreLog: () => void = () => undefined;

beforeAll(async () => {
  restoreLog = setLogSink((level, msg, fields) => {
    logLines.push(JSON.stringify({ level, msg, ...fields }));
  });
  t = await boot(
    buildColyseusServer(ROOM, {
      auth,
      users: repos.users,
      matches: matchesProxy,
      limits: {
        guestPerIpPerHour: 100_000,
        guestGlobalPerHour: 100_000,
        refreshPerIpPerMin: 100_000,
        perIpPerMin: 100_000,
        perUserPerMin: 100_000,
      },
      lobby: {
        fillMs: 1500,
        creatorMs: 1500,
        actionsPerIpPerMin: 100_000,
        actionsPerUserPerMin: 100_000,
        createPerUserPerMin: 1000,
        joinMinLatencyMs: 0,
        guard: {
          attemptsPerIpPerMin: 100_000,
          attemptsPerUserPerMin: 100_000,
          failsPerIp: 100_000,
          failLockThreshold: 6,
        },
      },
    }),
    2581,
  );
});

const everyone: User[] = [];
beforeEach(() => {
  repos.store.matches.length = 0;
  impl = repos.matches;
  logLines.length = 0;
});
afterEach(async () => {
  for (const u of everyone.splice(0)) await call('POST', '/queue/leave', u.token);
  await t.cleanup();
});
afterAll(async () => {
  await t.shutdown();
  restoreLog();
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return;
    await sleep(5);
  }
  throw new Error(`timeout esperando: ${what}`);
}

const port = (): number =>
  ((t.server.transport.server as { address(): unknown }).address() as AddressInfo).port;

interface Reply {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Headers;
}
async function call(method: string, path: string, token?: string, body?: unknown): Promise<Reply> {
  const res = await fetch(`http://127.0.0.1:${port()}${path}`, {
    method,
    headers: {
      ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : JSON.parse(text), headers: res.headers };
}

interface User {
  id: string;
  token: string;
}
async function guest(): Promise<User> {
  const r = await call('POST', '/auth/guest');
  expect(r.status).toBe(201);
  const u = { id: r.body.user.id as string, token: r.body.accessToken as string };
  everyone.push(u);
  return u;
}
const guests = (n: number): Promise<User[]> => Promise.all(Array.from({ length: n }, guest));

type SdkRoom = Awaited<ReturnType<ColyseusTestServer['connectTo']>>;
const sdkRooms: unknown[] = [];
async function sit(reservation: unknown): Promise<SdkRoom> {
  const room = await t.sdk.consumeSeatReservation(reservation as never);
  for (const type of ['event', 'turnTimer', 'presence', 'error', 'signal', 'sfx', 'chat']) {
    room.onMessage(type, () => undefined);
  }
  sdkRooms.push(room);
  return room as unknown as SdkRoom;
}
function roomAlive(roomId: string): boolean {
  try {
    return matchMaker.getLocalRoomById(roomId) !== undefined;
  } catch {
    return false;
  }
}
const serverRoom = (roomId: string): TrucoRoom => matchMaker.getLocalRoomById(roomId) as TrucoRoom;
/** Turnos lentos nesta mesa (o servidor lê `config` a cada turno). Antes do 4º sentar. */
function slow(room: TrucoRoom): void {
  const r = room as unknown as { config: TrucoRoomConfig };
  r.config = { ...r.config, turnTimeoutMs: 120_000 };
}

interface Table {
  users: User[];
  code: string;
  room: TrucoRoom;
  clients: SdkRoom[];
}
/** Dono cria; os outros entram pelo código. `beforeFull` roda antes do último sentar. */
async function privateTable(opts: { slowTurns?: boolean; users?: User[] } = {}): Promise<Table> {
  const users = opts.users ?? (await guests(4));
  const created = await call('POST', '/tables', users[0]!.token, PRIV);
  expect(created.status).toBe(201);
  const room = serverRoom(created.body.reservation.roomId);
  if (opts.slowTurns === true) slow(room);
  const clients = [await sit(created.body.reservation)];
  for (const u of users.slice(1)) {
    const j = await call('POST', '/tables/join', u.token, { code: created.body.code });
    expect(j.status, JSON.stringify(j.body)).toBe(200);
    clients.push(await sit(j.body.reservation));
  }
  return { users, code: created.body.code as string, room, clients };
}

const stored = (): { id: string; input: FinishedMatchInput }[] =>
  repos.store.matches as unknown as { id: string; input: FinishedMatchInput }[];

describe('mesa privada por código, partida até o fim e registro', () => {
  it('4 convidados: criar, entrar por código, jogar até o fim; registro conferido campo a campo', async () => {
    const SECRET = 'SEGREDO-DO-CHAT-777';
    const tb = await privateTable();
    expect(tb.code).toMatch(/^[A-HJ-KM-NP-Z2-9]{8}$/);
    expect(tb.room.state.roomCode).toBe(tb.code);
    // chat e sinal durante a partida (chegam ao parceiro, mas NUNCA ao registro)
    const heard: string[] = [];
    tb.clients[2]!.onMessage('chat', (m: { text?: string }) => heard.push(m.text ?? ''));
    await until(() => tb.room.series !== null, 'série iniciada');
    tb.clients[0]!.send('chat', { scope: 'table', text: SECRET });
    tb.clients[1]!.send('signal', { signalId: 'piscar_olho' });
    tb.clients[3]!.send('sfx', { sfxId: 'risada' });
    tb.clients[3]!.send('chat', { scope: 'table', text: `${SECRET}-mesa` });

    await until(() => stored().length === 1, 'partida gravada');
    const { input } = stored()[0]!;
    expect(input.status).toBe('finished');
    expect([0, 1]).toContain(input.winnerTeam);
    expect(input.winnerTeam).toBe(tb.room.series!.winner);
    expect(input.seed).toBe(7);
    expect(input.seed).toBe(tb.room.seed);
    expect(input.roomCode).toBe(tb.code);
    expect(input).toMatchObject({
      variant: 'paulista',
      format: 'single',
      ironHand: false,
      visibility: 'private',
    });
    expect(input.options).toMatchObject({ ...PRIV, endReason: 'finished' });
    expect(input.options).not.toHaveProperty('logTruncated');
    expect(input.startedAt.getTime()).toBeLessThanOrEqual(input.endedAt.getTime());
    // jogadores: assentos 0..3 na ordem de chegada, o criador no 0; ninguém foi bot
    expect(input.players.map((p) => p.userId)).toEqual(tb.users.map((u) => u.id));
    expect(input.players.map((p) => [p.seat, p.team, p.botFrom])).toEqual([
      [0, 0, null],
      [1, 1, null],
      [2, 0, null],
      [3, 1, null],
    ]);
    // eventos: visão pública, seq crescente a partir de 1, começa e termina como deve
    const types = input.events.map((e) => (e.event as { type: string }).type);
    expect(types[0]).toBe('gameStarted');
    expect(types.at(-1)).toBe('seriesDecided');
    expect(input.events.map((e) => e.seq)).toEqual(input.events.map((_, i) => i + 1));
    expect(input.events).toHaveLength(tb.room.eventLog.length);
    expect(input.games).toEqual([
      expect.objectContaining({ game: 1, winnerTeam: input.winnerTeam }),
    ]);
    // deals (auditoria): uma entrada por mão, com as cartas de todos; só no registro
    const hands = types.filter((x) => x === 'handStarted').length;
    expect(input.deals).toHaveLength(hands);
    expect((input.deals![0] as { hands: unknown[] }).hands).toHaveLength(4);
    const publicPart = JSON.stringify(input.events);
    expect(publicPart).not.toContain('"hands"');
    // chat, sinais e sfx NUNCA gravados (varredura no registro inteiro)
    const everything = JSON.stringify(input);
    expect(everything).not.toContain('SEGREDO');
    expect(everything).not.toMatch(/"type":"(chat|signal|sfx)"/);
    expect(everything).not.toContain('piscar_olho');
    expect(everything).not.toContain('risada');
    // ...mas a mesa de fato recebeu (a varredura não é vazia por falta de envio)
    expect(heard).toContain(SECRET);
    // idempotente: depois de a sala fechar (onDispose) continua um registro só
    await until(() => tb.room.state.phase === 'finished', 'fim');
    await sleep(300);
    await Promise.race([tb.room.disconnect(), sleep(2000)]);
    expect(stored()).toHaveLength(1);
    // listagem do jogador não expõe deals/events/seed
    const page = await repos.matches.listForUser(tb.users[0]!.id);
    const summary = JSON.stringify(page);
    expect(summary).not.toMatch(/deals|events|seed/);
    expect(page.items[0]?.players).toHaveLength(4);
  });

  it('o criador é o primeiro assento: estranho com o código não entra antes dele sentar', async () => {
    const [a, b] = await guests(2);
    const created = await call('POST', '/tables', a!.token, PRIV);
    expect(created.status).toBe(201);
    const early = await call('POST', '/tables/join', b!.token, { code: created.body.code });
    expect(early.status).toBe(404);
    expect(early.body).toEqual({ error: { code: 'TABLE_UNAVAILABLE' } });
    await sit(created.body.reservation);
    const late = await call('POST', '/tables/join', b!.token, { code: created.body.code });
    expect(late.status).toBe(200);
    await sit(late.body.reservation); // reserva pendente seguraria o desligamento da sala
  });

  it('criador que nunca senta: a mesa fecha e o usuário fica livre', async () => {
    const [a] = await guests(1);
    const created = await call('POST', '/tables', a!.token, PRIV);
    expect(created.status).toBe(201);
    const roomId = created.body.reservation.roomId as string;
    expect(getLobby()?.slotKind(a!.id)).toBe('ticket');
    await until(() => getLobby()?.slotKind(a!.id) === null, 'slot livre', 8000);
    let found: unknown;
    try {
      found = await matchMaker.getRoomById(roomId);
    } catch {
      found = undefined;
    }
    expect(found).toBeFalsy();
    const again = await call('POST', '/tables', a!.token, PRIV);
    expect(again.status).toBe(201);
  });

  it('P2: criador que senta e sai antes do prazo NÃO fecha a mesa com amigos dentro; volta pelo código', async () => {
    const [a, b] = await guests(2);
    const created = await call('POST', '/tables', a!.token, PRIV);
    expect(created.status).toBe(201);
    const roomId = created.body.reservation.roomId as string;
    const owner = await sit(created.body.reservation);
    const j = await call('POST', '/tables/join', b!.token, { code: created.body.code });
    expect(j.status).toBe(200);
    await sit(j.body.reservation);
    await owner.leave(true);
    await until(() => getLobby()?.slotKind(a!.id) === null, 'criador liberado');
    // passa bem do prazo do criador (creatorMs = 1500): o timer não pode fechar a mesa
    await sleep(2300);
    expect(roomAlive(roomId)).toBe(true);
    expect(serverRoom(roomId).clients.length).toBe(1);
    const back = await call('POST', '/tables/join', a!.token, { code: created.body.code });
    expect(back.status).toBe(200);
    await sit(back.body.reservation);
  });

  it('um userId, uma mesa: criar, entrar e fila são recusados enquanto está sentado', async () => {
    const tb = await privateTable({ slowTurns: true });
    const owner = tb.users[0]!;
    expect((await call('POST', '/tables', owner.token, PRIV)).status).toBe(409);
    expect((await call('POST', '/queue', owner.token, PUB)).body.error.code).toBe(
      'ALREADY_IN_TABLE',
    );
    const [other] = await guests(1);
    const second = await call('POST', '/tables', other!.token, PRIV);
    expect(second.status).toBe(201);
    await sit(second.body.reservation);
    const crossJoin = await call('POST', '/tables/join', other!.token, { code: tb.code });
    expect(crossJoin.status).toBe(409);
    expect(crossJoin.body.error.code).toBe('ALREADY_IN_TABLE');
  });

  it('4: POST /queue/leave devolve o estado real (sentado continua seated; criador mantém o ticket)', async () => {
    const tb = await privateTable({ slowTurns: true });
    const seated = await call('POST', '/queue/leave', tb.users[0]!.token);
    expect(seated.status).toBe(200);
    expect(seated.body).toEqual({ status: 'seated' });
    expect(getLobby()?.slotKind(tb.users[0]!.id)).toBe('table');

    const [c] = await guests(1);
    const created = await call('POST', '/tables', c!.token, PRIV);
    expect(created.status).toBe(201);
    expect((await call('POST', '/queue/leave', c!.token)).body).toEqual({ status: 'idle' });
    expect(getLobby()?.slotKind(c!.id)).toBe('ticket'); // a mesa privada não foi abandonada
    // ...e o criador sem reserva reentra pelo código (5), sem 409
    const again = await call('POST', '/tables/join', c!.token, { code: created.body.code });
    expect(again.status).toBe(200);
    await sit(again.body.reservation);
  });

  it('10: sair de vez (o bot assume) libera o vínculo; sentado em outra mesa, a antiga é recusada', async () => {
    const tb = await privateTable({ slowTurns: true });
    await until(() => tb.room.series !== null, 'série');
    const leaver = tb.users[1]!;
    await tb.clients[1]!.leave(true);
    await until(() => getLobby()?.slotKind(leaver.id) === null, 'vínculo liberado');
    expect(tb.room.state.players[1]?.isBot).toBe(true);
    const other = await call('POST', '/tables', leaver.token, PRIV);
    expect(other.status).toBe(201);
    await sit(other.body.reservation);
    expect(getLobby()?.slotKind(leaver.id)).toBe('table');
    const back = await call('POST', '/tables/join', leaver.token, { code: tb.code });
    expect(back.status).toBe(409);
    expect(back.body.error.code).toBe('ALREADY_IN_TABLE');
    const direct = await call('POST', `/matchmake/joinById/${tb.room.roomId}`, leaver.token, {
      code: tb.code,
    });
    expect(direct.status).not.toBe(200);
    expect(tb.room.state.players[1]?.isBot).toBe(true); // a cadeira segue com o bot
  });

  it('10: reconexão com o matchmake direto desligado (padrão): o dono volta ao assento', async () => {
    const tb = await privateTable({ slowTurns: true });
    await until(() => tb.room.series !== null, 'série');
    const owner = tb.users[2]!;
    const sdk = tb.clients[2]!;
    sdk.reconnection.enabled = false;
    sdk.connection.close();
    await until(() => tb.room.state.players[2]?.status === 'away', 'away');
    const http = t.sdk.http as unknown as { options: { headers?: Record<string, string> } };
    const before = http.options.headers;
    http.options.headers = { authorization: `Bearer ${owner.token}` };
    try {
      const back = await t.sdk.reconnect(sdk.reconnectionToken);
      expect(back.connection.isOpen).toBe(true);
    } finally {
      http.options.headers = before ?? {};
    }
    await until(() => tb.room.state.players[2]?.status === 'connected', 'dono de volta');
  });

  it('ponta a ponta: guest -> JWT -> lobby -> queda no meio da partida -> refresh -> reconexão com o JWT novo -> fim e registro, sem vazar carta', async () => {
    // 4 convidados pelo caminho real, guardando o refresh token do que vai cair.
    const raw = await Promise.all(Array.from({ length: 4 }, () => call('POST', '/auth/guest')));
    const users: User[] = raw.map((r) => ({ id: r.body.user.id, token: r.body.accessToken }));
    everyone.push(...users);
    const refreshToken = raw[2]!.body.refreshToken as string;
    const tb = await privateTable({ slowTurns: true, users });
    await until(() => tb.room.series !== null, 'série iniciada');

    // queda do assento 2
    const dropped = tb.clients[2]!;
    dropped.reconnection.enabled = false;
    dropped.connection.close();
    await until(() => tb.room.state.players[2]?.status === 'away', 'assento 2 away');

    // intruso (JWT válido de outro jogador da mesa) não retoma o assento alheio
    const http = t.sdk.http as unknown as { options: { headers?: Record<string, string> } };
    const before = http.options.headers;
    http.options.headers = { authorization: `Bearer ${users[1]!.token}` };
    try {
      await expect(t.sdk.reconnect(dropped.reconnectionToken)).rejects.toBeDefined();
    } finally {
      http.options.headers = before ?? {};
    }
    expect(tb.room.state.players[2]?.status).toBe('away');

    // o dono renova o access com o refresh e reconecta com o token NOVO
    const refreshed = await call('POST', '/auth/refresh', undefined, { refreshToken });
    expect(refreshed.status).toBe(200);
    const fresh = refreshed.body.accessToken as string;
    expect(fresh).not.toBe(users[2]!.token);
    http.options.headers = { authorization: `Bearer ${fresh}` };
    let back: SdkRoom;
    try {
      back = await t.sdk.reconnect(dropped.reconnectionToken);
    } finally {
      http.options.headers = before ?? {};
    }
    for (const type of ['event', 'turnTimer', 'presence', 'error', 'signal', 'sfx', 'chat']) {
      back.onMessage(type, () => undefined);
    }
    sdkRooms.push(back);
    await until(() => tb.room.state.players[2]?.status === 'connected', 'dono de volta');

    // o cliente reconectado enxerga só as próprias cartas (e o estado fica em dia com o servidor)
    const view = back as unknown as {
      state: { toJSON(): unknown };
      serializer: { decoder: RefHolder };
    };
    await until(
      () =>
        leakViolations(view.state.toJSON(), tb.room.series!, 2, 'reconexão JWT', {
          decoder: view.serializer.decoder,
        }).length === 0,
      'estado do reconectado em dia e sem vazamento',
    );

    // acelera os turnos: a partida termina e é gravada com os 4 humanos
    const r = tb.room as unknown as { config: TrucoRoomConfig };
    r.config = { ...r.config, turnTimeoutMs: 15 };
    // o turno em curso já tem o prazo lento armado: dispara-o uma vez (o resto usa o prazo curto)
    const room = tb.room as unknown as {
      currentTurn: { seat: number } | null;
      onTurnTimeout(seat: number): void;
    };
    if (room.currentTurn !== null) room.onTurnTimeout(room.currentTurn.seat);
    await until(() => stored().length === 1, 'partida gravada');
    const { input } = stored()[0]!;
    expect(input.players.map((p) => p.userId)).toEqual(users.map((u) => u.id));
    expect(input.status).toBe('finished');
  });

  it('direct matchmake de create/join/joinOrCreate da sala truco é bloqueado (403 USE_LOBBY)', async () => {
    const [a] = await guests(1);
    for (const method of ['create', 'join', 'joinOrCreate']) {
      const r = await call('POST', `/matchmake/${method}/truco`, a!.token, PRIV);
      expect(r.status).toBe(403);
      expect(JSON.stringify(r.body)).toContain('USE_LOBBY');
    }
    expect((await call('POST', '/matchmake/create/truco', undefined, PRIV)).status).toBe(401);
  });

  it('cliente não escolhe seed/timers/roomId: campos extras ou mesa pública em POST /tables dão 400', async () => {
    const [a] = await guests(1);
    for (const extra of [
      { rngSeed: 1 },
      { turnTimeoutMs: 1 },
      { roomId: 'x' },
      { __lobbyGrant: 'x' },
    ]) {
      const r = await call('POST', '/tables', a!.token, { ...PRIV, ...extra });
      expect(r.status).toBe(400);
    }
    expect((await call('POST', '/tables', a!.token, PUB)).status).toBe(400);
    expect((await call('POST', '/queue', a!.token, { ...PUB, format: 'bo3' })).status).toBe(400);
    expect((await call('POST', '/queue', a!.token, PRIV)).status).toBe(400);
    expect((await call('POST', '/tables', undefined, PRIV)).status).toBe(401);
    // bo3 é permitido em mesa privada
    const bo3 = await call('POST', '/tables', a!.token, { ...PRIV, format: 'bo3' });
    expect(bo3.status).toBe(201);
    expect(serverRoom(bo3.body.reservation.roomId).state.options.format).toBe('bo3');
  });
});

describe('entrar por código: sem oráculo, com limite e bloqueio', () => {
  it('inexistente, em partida, mesa da fila e mesa fechada: resposta idêntica; formato inválido: 400', async () => {
    const tb = await privateTable({ slowTurns: true }); // começa e fica em partida
    await until(() => tb.room.series !== null, 'em partida');
    const [probe] = await guests(1);
    // mesa da fila (código real de uma sala pública)
    const q = await guests(4);
    let queueRoomId = '';
    for (const u of q) await call('POST', '/queue', u.token, PUB);
    const st = await call('GET', '/queue', q[0]!.token);
    expect(st.body.status).toBe('matched');
    queueRoomId = st.body.reservation.roomId;
    const queueCode = serverRoom(queueRoomId).state.roomCode;
    // mesa fechada: o código existia e a sala foi embora
    const [closer] = await guests(1);
    const closing = await call('POST', '/tables', closer!.token, PRIV);
    await sit(closing.body.reservation);
    await serverRoom(closing.body.reservation.roomId).disconnect();
    const replies = [];
    for (const code of ['AAAAAAAA', tb.code, queueCode, closing.body.code as string]) {
      replies.push(await call('POST', '/tables/join', probe!.token, { code }));
    }
    for (const r of replies) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: { code: 'TABLE_UNAVAILABLE' } });
      expect(r.headers.get('content-length')).toBe(replies[0]!.headers.get('content-length'));
    }
    const bad = await call('POST', '/tables/join', probe!.token, { code: 'abc' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_CODE');
    expect((await call('POST', '/tables/join', probe!.token, { code: tb.code, x: 1 })).status).toBe(
      400,
    );
  });

  it('7: entrar direto por roomId (joinById) conta falhas e bloqueia o usuário', async () => {
    const [a] = await guests(1);
    for (let i = 0; i < 6; i++) {
      const r = await call('POST', `/matchmake/joinById/inexistente${i}`, a!.token, {});
      expect(r.status).not.toBe(200);
      expect(r.status).not.toBe(429);
    }
    const blocked = await call('POST', '/matchmake/joinById/inexistente7', a!.token, {});
    expect(blocked.status).toBe(429);
    expect(getLobby()?.isLocked(a!.id)).toBe(true);
  });

  it('8: toda recusa de /tables/join respeita o piso de latência (caminho rápido e caminho da sala)', async () => {
    const cfg = getLobby()!.config as unknown as { joinMinLatencyMs: number };
    cfg.joinMinLatencyMs = 120;
    try {
      const tb = await privateTable({ slowTurns: true });
      await until(() => tb.room.series !== null, 'em partida');
      const [probe] = await guests(1);
      for (const code of ['AAAAAAAA', tb.code]) {
        const t0 = Date.now();
        const r = await call('POST', '/tables/join', probe!.token, { code });
        expect(r.status).toBe(404);
        expect(Date.now() - t0).toBeGreaterThanOrEqual(115);
      }
    } finally {
      cfg.joinMinLatencyMs = 0;
    }
  });

  it('N falhas bloqueiam o usuário (429) mesmo com o código certo; outro usuário não é afetado', async () => {
    const [owner, chutador, amigo] = await guests(3);
    const created = await call('POST', '/tables', owner!.token, PRIV);
    await sit(created.body.reservation);
    for (let i = 0; i < 6; i++) {
      const r = await call('POST', '/tables/join', chutador!.token, {
        code: `AAAAAAA${'BCDEFG'[i]}`,
      });
      expect(r.status).toBe(404);
    }
    const blocked = await call('POST', '/tables/join', chutador!.token, {
      code: created.body.code,
    });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    expect(getLobby()?.isLocked(chutador!.id)).toBe(true);
    const ok = await call('POST', '/tables/join', amigo!.token, { code: created.body.code });
    expect(ok.status).toBe(200);
    await sit(ok.body.reservation);
  });
});

describe('fila pública FIFO', () => {
  it('4 convidados entram na fila, recebem a mesa, jogam até o fim e a partida pública é gravada', async () => {
    const users = await guests(4);
    for (const [i, u] of users.entries()) {
      const r = await call('POST', '/queue', u.token, PUB);
      expect(r.status).toBe(200);
      expect(r.body.status).toBe(i === 3 ? 'matched' : 'queued');
    }
    const clients: SdkRoom[] = [];
    for (const u of users) {
      const s = await call('GET', '/queue', u.token);
      expect(s.body.status).toBe('matched');
      clients.push(await sit(s.body.reservation));
    }
    await until(() => stored().length === 1, 'partida da fila gravada');
    const { input } = stored()[0]!;
    expect(input).toMatchObject({ visibility: 'public', format: 'single', status: 'finished' });
    expect(new Set(input.players.map((p) => p.userId))).toEqual(new Set(users.map((u) => u.id)));
    expect((await call('GET', '/queue', users[0]!.token)).body.status).not.toBe('queued');
  });

  it('a mesa da fila é fechada a estranhos, mesmo sabendo o roomId (joinById direto)', async () => {
    const users = await guests(4);
    for (const u of users) await call('POST', '/queue', u.token, PUB);
    const first = await call('GET', '/queue', users[0]!.token);
    const roomId = first.body.reservation.roomId as string;
    slow(serverRoom(roomId));
    await sit(first.body.reservation);
    for (const u of users.slice(1, 3)) {
      await sit((await call('GET', '/queue', u.token)).body.reservation);
    }
    const [stranger] = await guests(1);
    const direct = await call('POST', `/matchmake/joinById/${roomId}`, stranger!.token, {});
    expect(direct.status).not.toBe(200);
    expect(getLobby()?.slotKind(stranger!.id)).toBeNull();
    await sit((await call('GET', '/queue', users[3]!.token)).body.reservation);
  });

  it('2: o assento vem do sorteio do lobby, não da ordem de entrada na sala', async () => {
    for (let round = 0; round < 3; round++) {
      const users = await guests(4);
      for (const u of users) await call('POST', '/queue', u.token, PUB);
      const reservations: unknown[] = [];
      for (const u of users)
        reservations.push((await call('GET', '/queue', u.token)).body.reservation);
      const roomId = (reservations[0] as { roomId: string }).roomId;
      const room = serverRoom(roomId);
      slow(room);
      // entram em ordem INVERTIDA à da fila
      for (let i = 3; i >= 0; i--) await sit(reservations[i]);
      const priv = room as unknown as { grant: Grant; userBySeat: Map<number, string> };
      expect(priv.grant.seats?.size).toBe(4);
      for (const u of users) {
        expect(priv.userBySeat.get(priv.grant.seats!.get(u.id)!)).toBe(u.id);
      }
    }
  });

  it('3: quem casa e não senta paga o cooldown de reentrada (429 QUEUE_COOLDOWN com Retry-After)', async () => {
    const users = await guests(4);
    for (const u of users) await call('POST', '/queue', u.token, PUB);
    for (const u of users.slice(0, 3))
      await sit((await call('GET', '/queue', u.token)).body.reservation);
    await until(() => getLobby()?.slotKind(users[0]!.id) === 'queued', 'mesa não encheu', 6000);
    const absent = await call('POST', '/queue', users[3]!.token, PUB);
    expect(absent.status).toBe(429);
    expect(absent.body.error.code).toBe('QUEUE_COOLDOWN');
    expect(Number(absent.headers.get('retry-after'))).toBeGreaterThan(0);
    // quem sentou foi devolvido à fila sem pena
    expect((await call('GET', '/queue', users[0]!.token)).body.status).toBe('queued');
  });

  it('um userId, uma fila: duas entradas (outra variante) continuam sendo uma; sair da fila libera', async () => {
    const [a] = await guests(1);
    expect((await call('POST', '/queue', a!.token, PUB)).body.status).toBe('queued');
    expect(
      (await call('POST', '/queue', a!.token, { ...PUB, variant: 'mineiro' })).body.status,
    ).toBe('queued');
    expect(getLobby()?.stats().queued).toBe(1);
    expect((await call('POST', '/queue/leave', a!.token)).body).toEqual({ status: 'idle' });
    expect((await call('GET', '/queue', a!.token)).body).toEqual({ status: 'idle' });
    expect(getLobby()?.stats().queued).toBe(0);
  });

  it('mesa que não enche: quem sentou volta à fila (posição original) e o ausente fica livre', async () => {
    const users = await guests(4);
    for (const u of users) await call('POST', '/queue', u.token, PUB);
    const present = users.slice(0, 3);
    for (const u of present) {
      const s = await call('GET', '/queue', u.token);
      await sit(s.body.reservation);
    }
    // o 4º não aparece: passado fillMs a mesa fecha
    await until(
      () => getLobby()?.slotKind(present[0]!.id) === 'queued',
      'quem sentou voltou à fila',
      6000,
    );
    expect((await call('GET', '/queue', present[0]!.token)).body.status).toBe('queued');
    expect(getLobby()?.slotKind(users[3]!.id)).toBeNull();
    expect((await call('GET', '/queue', users[3]!.token)).body).toEqual({ status: 'idle' });
  });
});

describe('partida cancelada, abandonada e falha do banco', () => {
  it('voteCancel unânime: gravada como cancelada, sem vencedor', async () => {
    const tb = await privateTable({ slowTurns: true });
    await until(() => tb.room.series !== null, 'série');
    for (const c of tb.clients) c.send('voteCancel');
    await until(() => stored().length === 1, 'cancelada gravada');
    const { input } = stored()[0]!;
    expect(input.status).toBe('cancelled');
    expect(input.winnerTeam).toBeNull();
    expect(input.options).toMatchObject({ endReason: 'cancelled' });
    expect((input.events.at(-1)!.event as { type: string }).type).toBe('seriesCancelled');
  });

  it('todos saem: abandonada (cancelled + endReason abandoned) e botFrom marcado', async () => {
    const tb = await privateTable({ slowTurns: true });
    await until(() => tb.room.series !== null, 'série');
    for (const c of tb.clients) await c.leave(true);
    await until(() => stored().length === 1, 'abandonada gravada');
    const { input } = stored()[0]!;
    expect(input.status).toBe('cancelled');
    expect(input.options).toMatchObject({ endReason: 'abandoned' });
    expect(input.players.every((p) => p.botFrom !== null && p.userId !== null)).toBe(true);
    // todos saíram de vez: o vínculo global foi liberado
    for (const u of tb.users) expect(getLobby()?.slotKind(u.id)).toBeNull();
  });

  it('sala fechada com a série em andamento (desligamento) grava como abandonada', async () => {
    const tb = await privateTable({ slowTurns: true });
    await until(() => tb.room.series !== null, 'série');
    await tb.room.disconnect();
    await until(() => stored().length === 1, 'gravada no dispose');
    expect(stored()[0]!.input.status).toBe('cancelled');
    expect(stored()[0]!.input.options).toMatchObject({ endReason: 'abandoned' });
  });

  it('falha do banco NÃO derruba a sala: log sem PII, tentativas limitadas, a partida segue e fecha', async () => {
    let calls = 0;
    impl = {
      saveMatch: async () => {
        calls++;
        throw new PersistenceError('P1001', 'matches_events_size_check');
      },
      listForUser: repos.matches.listForUser.bind(repos.matches),
    };
    const tb = await privateTable();
    await until(() => tb.room.state.phase === 'finished', 'partida terminou apesar do banco');
    await until(() => calls === 3, 'três tentativas', 8000);
    await sleep(1300);
    expect(calls).toBe(3); // limitado
    expect(stored()).toHaveLength(0);
    const errors = logLines.filter((l) => l.includes('falha ao gravar partida'));
    expect(errors.length).toBe(3);
    const all = logLines.join('\n');
    for (const u of tb.users) expect(all).not.toContain(u.id);
    expect(all).not.toContain(tb.code);
    expect(errors[0]).toContain('P1001');
    // a sala fechou normalmente
    // a sala segue de pé e o servidor serve novas mesas
    const [again] = await guests(1);
    expect((await call('POST', '/tables', again!.token, PRIV)).status).toBe(201);
  }, 15_000);

  it('falha transitória: grava na 3ª tentativa e só uma vez', async () => {
    let calls = 0;
    impl = {
      saveMatch: async (input) => {
        calls++;
        if (calls < 3) throw new Error('rede');
        return repos.matches.saveMatch(input);
      },
      listForUser: repos.matches.listForUser.bind(repos.matches),
    };
    const tb = await privateTable();
    await until(() => stored().length === 1, 'gravada após retry', 8000);
    await until(() => tb.room.state.phase === 'finished', 'fim');
    await sleep(600);
    expect(stored()).toHaveLength(1);
    expect(calls).toBe(3);
  }, 15_000);
});
