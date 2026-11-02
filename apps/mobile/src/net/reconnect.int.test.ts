/**
 * VEREDITO DO RISCO CRÍTICO: integração com o servidor REAL e o SDK Colyseus REAL.
 * - 4 convidados criam/entram numa mesa privada por código e consomem a reserva;
 * - uma conexão é derrubada e volta por (a) reconexão automática do SDK e (b) `client.reconnect(token)`,
 *   sempre com o JWT em `Sec-WebSocket-Protocol: trucaco.bearer, <jwt>`;
 * - o controle negativo emula o ramo de NAVEGADOR do SDK (`typeof document !== 'undefined'`) com o
 *   `Client` puro: a reconexão falha, e o mesmo caso passa com o shim.
 * `INT_SLOW=1` liga o teste de JWT expirado durante a queda (~70 s, TTL do access = 60 s no servidor).
 */
import { Client, CloseCode } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import type { CreateTableRequest } from '@trucaco/protocol';
import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GameClientError, createGameClient, trackEvents } from './colyseus';
import type { GameClient } from './colyseus';
import { startServer } from './integrationServer';
import type { RunningServer } from './integrationServer';
import { createSession } from './session';
import type { Session } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';

const awayCount = (): number => presence[0]!.filter((p) => p.status === 'away').length;

/** Derruba a conexão sem consentimento e espera o servidor registrar a queda (abre a janela de reconexão). */
async function dropAndWait(room: Room): Promise<void> {
  const before = awayCount();
  room.reconnection.enabled = false;
  const left = new Promise<void>((r) => room.onLeave(() => r()));
  room.connection.close(CloseCode.MAY_TRY_RECONNECT);
  await left;
  await waitFor(() => awayCount() > before, 'servidor registrou a queda');
}

/** Upgrade WebSocket cru (sem cliente Colyseus): devolve o status HTTP da recusa, ou 101. */
function rawUpgradeStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
        ...headers,
      },
    });
    req.once('response', (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.once('upgrade', (res, socket) => {
      socket.destroy();
      resolve(res.statusCode ?? 101);
    });
    req.once('error', reject);
    req.end();
  });
}

const OPTIONS: CreateTableRequest = {
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'private',
};

interface Snapshot {
  phase: string;
  players: Array<{ status: string }>;
}
const snap = (room: Room): Snapshot => (room.state as unknown as { toJSON(): Snapshot }).toJSON();

async function waitFor(pred: () => boolean, label: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

let server: RunningServer;
let sessions: Session[];
let gcs: GameClient[];
let rooms: Room[];
const presence: Array<Array<{ seat: number; status: string }>> = [[], [], [], []];
const trackers: Array<ReturnType<typeof trackEvents>> = [];
const desyncs: number[] = [0, 0, 0, 0];
let issuedAt = 0;

/** Registra os handlers de mensagem de uma sala (inclusive as reconectadas) e a guarda no assento i. */
function attach(i: number, room: Room): Room {
  room.onMessage('presence', (m: { seat: number; status: string }) => presence[i]!.push(m));
  for (const t of ['signal', 'sfx', 'chat', 'turnTimer', 'error'])
    room.onMessage(t, () => undefined);
  trackers[i] = trackEvents(
    room,
    {
      onEvent: () => undefined,
      onDesync: () => {
        desyncs[i] = (desyncs[i] ?? 0) + 1;
      },
    },
    trackers[i]?.lastSeq() ?? null,
  );
  rooms[i] = room;
  return room;
}

beforeAll(async () => {
  server = await startServer();
  // Relógio da sessão 10 min atrás: nunca renova por antecedência, então o 401 real é exercitado.
  const skewed = () => Date.now() - 600_000;
  issuedAt = Date.now();
  sessions = await Promise.all(
    [0, 1, 2, 3].map(async () => {
      const s = createSession({
        storage: createMemoryTokenStorage(),
        baseUrl: server.url,
        now: skewed,
      });
      expect((await s.start()).status).toBe('authenticated');
      return s;
    }),
  );
  gcs = sessions.map((s) => createGameClient(s, { serverUrl: server.url }));

  const created = await sessions[0]!.api.createTable(OPTIONS);
  expect(created.code).toMatch(/^[A-Z2-9]{8}$/);
  rooms = [];
  // A sala só existe depois que o criador consome a reserva; os demais entram por código.
  attach(0, await gcs[0]!.joinWithReservation(created.reservation));
  for (let i = 1; i < 4; i++) {
    const { reservation } = await sessions[i]!.api.joinTable(created.code);
    attach(i, await gcs[i]!.joinWithReservation(reservation));
  }
  await waitFor(
    () => snap(rooms[0]!).players.every((p) => p.status === 'connected'),
    '4 conectados',
  );
}, 40_000);

afterAll(async () => {
  for (const r of rooms ?? []) await r.leave().catch(() => undefined);
  for (const g of gcs ?? []) g.dispose();
  await server?.stop();
});

describe('entrada por código com o SDK real', () => {
  it('os 4 estão sentados, em assentos distintos, e a mesa começa', async () => {
    expect(new Set(rooms.map((r) => r.sessionId)).size).toBe(4);
    await waitFor(() => snap(rooms[0]!).phase === 'playing', 'partida em andamento');
    for (const r of rooms) expect(r.reconnectionToken).toMatch(/^.+:.+$/);
  });
});

describe('reconexão com o JWT no subprotocolo', () => {
  it('(a) reconexão AUTOMÁTICA do SDK volta conectada, com replay sem desincronizar', async () => {
    const room = rooms[1]!;
    room.reconnection.minUptime = 0; // o SDK só reconecta sozinho depois de 5 s de sala
    const events: string[] = [];
    room.onDrop(() => events.push('drop'));
    room.onReconnect(() => events.push('reconnect'));
    const sessionBefore = room.sessionId;
    room.connection.close(CloseCode.MAY_TRY_RECONNECT);
    await waitFor(() => events.includes('reconnect'), 'onReconnect');
    expect(events).toEqual(['drop', 'reconnect']);
    expect(room.sessionId).toBe(sessionBefore);
    expect(room.connection.isOpen).toBe(true);
    await waitFor(
      () => (snap(rooms[1]!).players ?? []).every((p) => p.status === 'connected'),
      'voltou a online',
    );
    // Os outros viram a queda (away) e o retorno.
    await waitFor(() => presence[0]!.some((p) => p.status === 'away'), 'presence away');
    expect(desyncs[1]).toBe(0);
  });

  it('(b) client.reconnect(token) após queda definitiva devolve sala com estado e presença', async () => {
    const old = rooms[2]!;
    const token = old.reconnectionToken;
    const seatBefore = old.sessionId;
    await dropAndWait(old);

    const lastBefore = trackers[2]?.lastSeq() ?? null;
    expect(lastBefore).not.toBeNull(); // houve eventos antes da queda
    const back = attach(2, await gcs[2]!.reconnect(token));
    expect(back.sessionId).toBe(seatBefore);
    expect(back.connection.isOpen).toBe(true);
    await waitFor(() => (snap(back).players ?? []).length === 4, 'estado completo');
    expect(snap(back).players.every((p) => p.status === 'connected')).toBe(true);
    expect(snap(back).phase).toBe('playing');
    expect(desyncs[2]).toBe(0); // replay contínuo a partir do último seq visto
    expect(trackers[2]?.lastSeq() ?? 0).toBeGreaterThanOrEqual(lastBefore ?? 0);
    expect(back.reconnectionToken).not.toBe(token); // o token rotaciona
  });

  it('token de sala inexistente vira ROOM_NOT_FOUND', async () => {
    const e = await gcs[0]!.reconnect('sala-que-nao-existe:token').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(GameClientError);
    expect((e as GameClientError).code).toBe('ROOM_NOT_FOUND');
  });

  it('CONTROLE: no ramo de navegador do SDK, o Client puro falha (sem JWT no upgrade) e o shim passa', async () => {
    const victim = rooms[3]!;
    const token = victim.reconnectionToken;
    const wsUrl = new URL(victim.connection.url!.replace(/^ws/, 'http'));
    wsUrl.searchParams.set('reconnectionToken', token.split(':')[1]!);
    wsUrl.searchParams.set('skipHandshake', '1');
    await dropAndWait(victim);

    const jwt = sessions[3]!.getAccessToken()!;
    // Upgrade da reconexão sem JWT (é o que o SDK faz no navegador e no RN): 401 do servidor.
    expect(await rawUpgradeStatus(wsUrl.toString(), {})).toBe(401);
    // Com o subprotocolo errado (JWT primeiro) o servidor também recusa, antes do handshake.
    expect(
      await rawUpgradeStatus(wsUrl.toString(), {
        'Sec-WebSocket-Protocol': `${jwt}, trucaco.bearer`,
      }),
    ).toBe(400);
    const plain = new Client(server.url, { headers: { authorization: `Bearer ${jwt}` } });
    (globalThis as { document?: unknown }).document = {}; // emula o navegador no SDK
    try {
      const failure = await plain.reconnect(token).then(
        () => 'conectou',
        (e: unknown) => e,
      );
      expect(failure).not.toBe('conectou');
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }

    // Mesmo emulando navegador, o shim usa o subprotocolo e entra.
    (globalThis as { document?: unknown }).document = {};
    try {
      const ok = await gcs[3]!.reconnect(token);
      attach(3, ok);
      expect(ok.connection.isOpen).toBe(true);
    } finally {
      delete (globalThis as { document?: unknown }).document;
    }
  });
});

describe('Node sem emulação de navegador', () => {
  it('o Client puro entra pelo cabeçalho Authorization (por isso o risco só existe em navegador e RN)', async () => {
    const room = rooms[1]!;
    const token = room.reconnectionToken;
    await dropAndWait(room);
    const plain = new Client(server.url, {
      headers: { authorization: `Bearer ${sessions[1]!.getAccessToken()!}` },
    });
    const back = await plain.reconnect(token);
    for (const t of ['presence', 'signal', 'sfx', 'chat', 'turnTimer', 'error', 'event']) {
      back.onMessage(t, () => undefined);
    }
    expect(back.connection.isOpen).toBe(true);
    await back.leave();
  });
});

describe.skipIf(process.env['INT_SLOW'] !== '1')('JWT expirado durante a queda (lento)', () => {
  it('401 no matchmake/upgrade -> refresh -> reconecta', async () => {
    const room = rooms[2]!;
    const token = room.reconnectionToken;
    const expiresAt = issuedAt + 60_000;
    // Derruba perto do fim da validade do access e reconecta já com ele vencido (janela do servidor: 60 s).
    await new Promise((r) => setTimeout(r, Math.max(0, expiresAt - 8000 - Date.now())));
    await dropAndWait(room);
    await new Promise((r) => setTimeout(r, Math.max(0, expiresAt + 3000 - Date.now())));
    const before = sessions[2]!.getAccessToken();
    const back = await gcs[2]!.reconnect(token);
    attach(2, back);
    expect(sessions[2]!.getAccessToken()).not.toBe(before); // houve refresh
    expect(back.connection.isOpen).toBe(true);
  }, 90_000);
});
