/**
 * Combinado da dupla contra o servidor REAL (`apps/server/dist/main.js`) e o SDK Colyseus real: dois humanos
 * da mesma dupla veem o mesmo `codes`, o adversário nunca recebe (nem `codes` nem chat da dupla), e o
 * significado combinado chega ao sinal do parceiro na mesa. Rode com `pnpm --filter @trucaco/mobile
 * test:int` (precisa de `pnpm build` antes).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createGameClient } from '../net/colyseus';
import { startServer } from '../net/integrationServer';
import type { RunningServer } from '../net/integrationServer';
import { createSession } from '../net/session';
import type { Session } from '../net/session';
import { createMemoryTokenStorage } from '../net/tokenStorageCore';
import { createRoomStore } from '../store/roomStore';
import type { RoomStore } from '../store/roomStore';
import { createTableController } from '../table/tableController';
import type { TableController } from '../table/tableController';
import { createTableStore } from '../table/tableStore';
import type { TableStore } from '../table/tableStore';
import { createRoomService } from './roomService';
import type { RoomLike, RoomService } from './roomService';

interface Player {
  session: Session;
  rooms: RoomService;
  roomStore: RoomStore;
  tableStore: TableStore;
  table: TableController;
  dispose(): void;
}

let server: RunningServer;
let players: Player[] = [];

async function boot(): Promise<Player> {
  const session = createSession({ storage: createMemoryTokenStorage(), baseUrl: server.url });
  expect((await session.start()).status).toBe('authenticated');
  const gameClient = createGameClient(session, { serverUrl: server.url });
  const roomStore = createRoomStore();
  const tableStore = createTableStore();
  let rooms: RoomService | null = null;
  const table = createTableController({
    store: tableStore,
    send: (m) => rooms?.send(m) ?? false,
  });
  rooms = createRoomService({
    store: roomStore,
    table,
    getClient: () => ({
      joinWithReservation: async (r) =>
        (await gameClient.joinWithReservation(r)) as unknown as RoomLike,
      reconnect: async (s) => (await gameClient.reconnect(s)) as unknown as RoomLike,
    }),
  });
  return {
    session,
    rooms,
    roomStore,
    tableStore,
    table,
    dispose: () => {
      gameClient.dispose();
      session.dispose();
    },
  };
}

async function waitFor(pred: () => boolean, label: string, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const settle = (ms = 400): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Senta `n` convidados em ordem numa mesa privada nova. */
async function seat(n: number): Promise<void> {
  const owner = players[0]!;
  const created = await owner.session.api.createTable({
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'private',
  });
  const code = await owner.rooms.enter(created.reservation);
  for (const p of players.slice(1, n)) {
    const joined = await p.session.api.joinTable(code);
    await p.rooms.enter(joined.reservation);
  }
  await waitFor(
    () => players.slice(0, n).every((p) => p.roomStore.getState().mySeat >= 0),
    'todos com assento',
  );
}

beforeAll(async () => {
  server = await startServer();
}, 30_000);

afterEach(async () => {
  for (const p of players) {
    await p.rooms.leave().catch(() => undefined);
    p.dispose();
  }
  players = [];
});

afterAll(async () => {
  await server?.stop();
});

describe('combinado da dupla contra o servidor real', () => {
  it('na espera, a dupla vê o mesmo codes e o chat da dupla; o adversário não recebe nada', async () => {
    players = [await boot(), await boot(), await boot()];
    await seat(3);
    // Assentos 0 e 2 são a dupla; 1 é adversário (a mesa ainda espera o 4º).
    const [a, c, b] = players as [Player, Player, Player]; // a = assento 0, c = assento 1, b = assento 2
    expect([a, c, b].map((p) => p.roomStore.getState().mySeat)).toEqual([0, 1, 2]);
    expect(a.roomStore.getState().tablePhase).toBe('waiting');

    expect(a.table.sendCode('wink', 'tenho o zap')).toBe(true);
    await waitFor(() => b.tableStore.getState().codes.wink === 'tenho o zap', 'parceiro recebe');
    await waitFor(
      () => a.tableStore.getState().codes.wink === 'tenho o zap',
      'eco para quem editou',
    );

    // O parceiro edita outro sinal: o mapa completo chega aos dois.
    await settle(1100); // intervalo de 1 s do servidor por assento
    expect(b.table.sendCode('nod', 'pode pedir')).toBe(true);
    await waitFor(
      () =>
        a.tableStore.getState().codes.nod === 'pode pedir' &&
        a.tableStore.getState().codes.wink === 'tenho o zap',
      'mapa completo no autor da primeira edição',
    );
    expect(b.tableStore.getState().codes).toEqual(a.tableStore.getState().codes);

    // Chat da dupla na espera.
    expect(a.table.sendChat('partner', 'combinei o zap')).toBe(true);
    await waitFor(
      () => b.tableStore.getState().chat.some((m) => m.scope === 'partner'),
      'chat da dupla na espera',
    );

    await settle();
    // O adversário não recebeu codes nem o chat da dupla.
    expect(c.tableStore.getState().codes).toEqual({});
    expect(c.tableStore.getState().chat.filter((m) => m.scope === 'partner')).toEqual([]);
  });

  it('na mesa, o sinal do parceiro mostra o significado combinado; adversários só veem o sinal', async () => {
    players = [await boot(), await boot(), await boot(), await boot()];
    await seat(3);
    const [a, , b] = players as [Player, Player, Player, Player];
    a.table.sendCode('wink', 'tenho o zap');
    await waitFor(() => b.tableStore.getState().codes.wink === 'tenho o zap', 'parceiro recebe');

    // O 4º senta e a partida começa: o combinado continua valendo.
    const last = players[3]!;
    const joined = await last.session.api.joinTable(a.roomStore.getState().roomCode);
    await last.rooms.enter(joined.reservation);
    await waitFor(
      () => players.every((p) => p.roomStore.getState().tablePhase === 'playing'),
      'partida em andamento',
    );
    expect(b.tableStore.getState().codes).toEqual({ wink: 'tenho o zap' });

    expect(a.table.sendSignal('wink')).toBe(true);
    await waitFor(
      () =>
        b.tableStore.getState().partnerSignalNote?.endsWith('Piscar um olho = tenho o zap') ===
        true,
      'parceiro vê o significado',
    );
    await settle();
    for (const adv of [players[1]!, players[3]!]) {
      expect(adv.tableStore.getState().partnerSignalNote).toBeNull();
      expect(adv.tableStore.getState().codes).toEqual({});
    }
  });

  it('texto que o servidor recusaria nem sai do cliente; o servidor aceita 60 caracteres', async () => {
    players = [await boot(), await boot(), await boot()];
    await seat(3);
    const [a, , b] = players as [Player, Player, Player];
    expect(a.table.sendCode('wink', 'x'.repeat(61))).toBe(false);
    expect(a.tableStore.getState().codesError).toBe('CHAT_BLOCKED');
    const sixty = 'y'.repeat(60);
    expect(a.table.sendCode('wink', sixty)).toBe(true);
    await waitFor(() => b.tableStore.getState().codes.wink === sixty, 'parceiro recebe 60');
  });
});
