/**
 * Integração do lobby (3E) contra o servidor REAL (`apps/server/dist/main.js`), com as peças reais do
 * cliente: sessão, cliente Colyseus, `roomService`, `lobbyController` e os stores. Duas jornadas:
 * (1) criar mesa privada e 3 convidados entram pelo código; (2) fila pública com 4 convidados.
 * Rode com `pnpm --filter @trucaco/mobile test:int` (precisa de `pnpm build` antes).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameClient } from '../net/colyseus';
import type { GameClient } from '../net/colyseus';
import { startServer } from '../net/integrationServer';
import type { RunningServer } from '../net/integrationServer';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createMemoryTokenStorage } from '../net/tokenStorageCore';
import { createRoomService } from '../room/roomService';
import type { RoomLike, RoomService } from '../room/roomService';
import { createLobbyStore } from '../store/lobbyStore';
import type { LobbyStore } from '../store/lobbyStore';
import { createRoomStore } from '../store/roomStore';
import type { RoomStore, RoomStoreState } from '../store/roomStore';
import { createLobbyController } from './lobbyController';
import type { LobbyController } from './lobbyController';

interface Player {
  session: Session;
  gameClient: GameClient;
  rooms: RoomService;
  roomStore: RoomStore;
  lobbyStore: LobbyStore;
  controller: LobbyController;
  /** Todas as projeções que a sala de espera recebeu, em ordem. */
  history: RoomStoreState[];
  entered: string[];
}

let server: RunningServer;
let players: Player[] = [];

async function newPlayer(): Promise<Player> {
  const session = createSession({ storage: createMemoryTokenStorage(), baseUrl: server.url });
  expect((await session.start()).status).toBe('authenticated');
  const gameClient = createGameClient(session, { serverUrl: server.url });
  const roomStore = createRoomStore();
  const lobbyStore = createLobbyStore();
  const rooms = createRoomService({
    store: roomStore,
    getClient: () => ({
      joinWithReservation: async (r) =>
        (await gameClient.joinWithReservation(r)) as unknown as RoomLike,
      reconnect: async (s) => (await gameClient.reconnect(s)) as unknown as RoomLike,
    }),
  });
  const entered: string[] = [];
  const history: RoomStoreState[] = [];
  roomStore.subscribe((s) => history.push(s));
  const controller = createLobbyController({
    api: session.api,
    store: lobbyStore,
    enter: (r) => rooms.enter(r),
    onEntered: (code) => entered.push(code),
    pollMs: 100,
  });
  return { session, gameClient, rooms, roomStore, lobbyStore, controller, history, entered };
}

async function waitFor(pred: () => boolean, label: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

const occupied = (s: RoomStoreState): number => s.seats.filter((p) => p.status !== 'empty').length;

async function freshPlayers(): Promise<void> {
  for (const p of players) {
    p.controller.dispose();
    await p.rooms.leave();
    p.gameClient.dispose();
    p.session.dispose();
  }
  players = await Promise.all([0, 1, 2, 3].map(() => newPlayer()));
}

beforeAll(async () => {
  server = await startServer();
}, 30_000);

afterAll(async () => {
  for (const p of players) {
    p.controller.dispose();
    await p.rooms.leave();
    p.gameClient.dispose();
    p.session.dispose();
  }
  await server?.stop();
});

function expectFourSeated(): void {
  const mySeats = new Set<number>();
  for (const p of players) {
    const s = p.roomStore.getState();
    expect(s.connection).toBe('connected');
    expect(s.roomCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(occupied(s)).toBe(4);
    expect(new Set(s.seats.map((x) => x.nickname)).size).toBe(4); // apelidos distintos
    expect(s.mySeat).toBeGreaterThanOrEqual(0);
    mySeats.add(s.mySeat);
  }
  expect(mySeats.size).toBe(4); // cada um no seu assento
  expect(new Set(players.map((p) => p.roomStore.getState().roomCode)).size).toBe(1); // mesma mesa
}

describe('mesa privada: criar e entrar por código', () => {
  it('guest cria, 3 outros entram pelo código e todos recebem a mesa com 4 assentos', async () => {
    await freshPlayers();
    const [owner, ...others] = players as [Player, Player, Player, Player];

    await owner.controller.createTable({ variant: 'paulista', format: 'bo3', ironHand: true });
    expect(owner.lobbyStore.getState().error).toBeNull();
    expect(owner.entered).toHaveLength(1);
    const code = owner.entered[0]!;
    expect(code).toMatch(/^[A-Z2-9]{8}$/);
    // O criador já viu a mesa em `waiting`, sozinho, com o código.
    expect(owner.history.some((h) => h.tablePhase === 'waiting' && h.roomCode === code)).toBe(true);

    // Código digitado em minúsculas e com hífen: a máscara normaliza antes da rede.
    const typed = `${code.slice(0, 4)}-${code.slice(4)}`.toLowerCase();
    for (const p of others) {
      await p.controller.joinByCode(typed);
      expect(p.lobbyStore.getState().error).toBeNull();
      expect(p.entered).toEqual([code]);
    }

    await waitFor(() => players.every((p) => occupied(p.roomStore.getState()) === 4), '4 sentados');
    expectFourSeated();
    // Os 3 que entraram ANTES do 4º viram `waiting` com o código (esperamos por estado, não por tempo).
    // O 4º dispara o início imediato (timer de 0 ms no servidor): o estado dele pode chegar já `playing`,
    // então dele se exige só o código e a mesa com 4 assentos conectados.
    for (const p of players.slice(0, 3)) {
      await waitFor(
        () => p.history.some((h) => h.tablePhase === 'waiting' && h.roomCode === code),
        'estado waiting com o código',
      );
    }
    const last = players[3]!;
    await waitFor(
      () =>
        last.history.some(
          (h) =>
            (h.tablePhase === 'waiting' || h.tablePhase === 'playing') &&
            h.roomCode === code &&
            h.seats.filter((x) => x.status === 'connected').length === 4,
        ),
      'o 4º viu a mesa (waiting ou playing) com 4 conectados',
    );
    // Sem consumir a vaga de novo: uma quinta pessoa recebe o MESMO erro de mesa indisponível.
    const fifth = await newPlayer();
    await fifth.controller.joinByCode(code);
    expect(fifth.lobbyStore.getState().error).toEqual({ scope: 'join', code: 'TABLE_UNAVAILABLE' });
    const ghost = await newPlayer();
    await ghost.controller.joinByCode('ZZZZZZZZ');
    expect(ghost.lobbyStore.getState().error).toEqual({ scope: 'join', code: 'TABLE_UNAVAILABLE' });
    for (const x of [fifth, ghost]) {
      x.gameClient.dispose();
      x.session.dispose();
    }
  }, 40_000);

  it('quem já está numa mesa recebe ALREADY_IN_TABLE ao criar outra', async () => {
    const owner = players[0]!;
    await owner.controller.createTable({ variant: 'mineiro', format: 'single', ironHand: false });
    expect(owner.lobbyStore.getState().error?.code).toBe('ALREADY_IN_TABLE');
    expect(owner.lobbyStore.getState().busy).toBe('none');
  });
});

describe('fila pública com 4 convidados', () => {
  it('entrada idempotente, matched, entrada na sala e seated', async () => {
    await freshPlayers();
    const first = players[0]!;

    // Idempotência: entrar duas vezes na fila pela API devolve `queued` nas duas.
    const opts = {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'public',
    } as const;
    const a = await first.session.api.joinQueue(opts);
    const b = await first.session.api.joinQueue(opts);
    expect(a.status).toBe('queued');
    expect(b.status).toBe('queued');
    if (a.status === 'queued' && b.status === 'queued') expect(b.expiresAt).toBe(a.expiresAt);
    expect((await first.session.api.queueStatus()).status).toBe('queued');

    // Os 4 pelo controlador: o primeiro já está na fila (idempotente), os outros entram e todos
    // acabam `matched` pelo polling de 100 ms e sentam.
    await Promise.all(
      players.map((p) => p.controller.startQueue({ variant: 'paulista', ironHand: true })),
    );
    await waitFor(() => players.every((p) => p.entered.length === 1), 'os 4 sentaram pela fila');
    await waitFor(() => players.every((p) => occupied(p.roomStore.getState()) === 4), '4 na mesa');
    expectFourSeated();
    for (const p of players) {
      expect(p.lobbyStore.getState().queue).toEqual({ status: 'idle' });
      expect(p.lobbyStore.getState().error).toBeNull();
      // O servidor reconhece o usuário como sentado.
      expect((await p.session.api.queueStatus()).status).toBe('seated');
    }
  }, 40_000);

  it('sair da fila: cancelar volta a idle também no servidor', async () => {
    await freshPlayers();
    const p = players[0]!;
    await p.controller.startQueue({ variant: 'mineiro', ironHand: false });
    expect(p.lobbyStore.getState().queue.status).toBe('queued');
    await p.controller.cancelQueue();
    expect(p.lobbyStore.getState().queue).toEqual({ status: 'idle' });
    expect((await p.session.api.queueStatus()).status).toBe('idle');
  }, 20_000);
});
