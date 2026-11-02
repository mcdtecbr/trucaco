/**
 * Integração da mesa (3H1) contra o servidor REAL (`apps/server/dist/main.js`) com as peças reais do
 * cliente: sessão, cliente Colyseus, `roomService`, `tableController` e `tableStore`. 4 convidados entram
 * por código e cada um joga uma mão inteira escolhendo a primeira ação legal que não seja apostar.
 * Rode com `pnpm --filter @trucaco/mobile test:int` (precisa de `pnpm build` antes).
 */
import { ERROR_CODES } from '@trucaco/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createLobbyController } from '../lobby/lobbyController';
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
import { createRoomStore } from '../store/roomStore';
import type { RoomStore } from '../store/roomStore';
import { createTableController } from './tableController';
import type { EventEnvelope, TableController } from './tableController';
import { createTableStore } from './tableStore';
import type { TableStore } from './tableStore';

interface Player {
  session: Session;
  gameClient: GameClient;
  rooms: RoomService;
  roomStore: RoomStore;
  tableStore: TableStore;
  table: TableController;
  controller: ReturnType<typeof createLobbyController>;
  /** `seq` de cada evento recebido, em ordem. */
  seqs: number[];
  desyncs: number;
  errors: string[];
  /** Fases vistas no `roomStore`, sem repetição consecutiva. */
  phases: string[];
  /** Cartas (rank+naipe) vistas no estado BRUTO da mão 1, por origem. */
  seenPublic: Set<string>;
  seenPrivate: Set<string>;
  /** Mão inicial do próprio jogador na mão 1. */
  firstHand: string[];
  /** Estados em que havia `legalActions` sem ser a vez do jogador. */
  actionsOutOfTurn: string[];
  rawStates: number;
}

let server: RunningServer;
let players: Player[] = [];

const key = (c: { rank: unknown; suit: unknown }): string => `${String(c.rank)}|${String(c.suit)}`;

/** Varre o estado bruto: cartas sob `privates` são privadas; o resto (vaza, vira) é público. */
function scan(node: unknown, inPrivate: boolean, pub: Set<string>, priv: Set<string>): void {
  if (Array.isArray(node)) {
    for (const x of node) scan(x, inPrivate, pub, priv);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const o = node as Record<string, unknown>;
  if (typeof o['rank'] === 'string' && typeof o['suit'] === 'string' && o['rank'] !== '') {
    (inPrivate ? priv : pub).add(key(o as { rank: string; suit: string }));
  }
  for (const [k, v] of Object.entries(o)) scan(v, inPrivate || k === 'privates', pub, priv);
}

async function newPlayer(): Promise<Player> {
  const session = createSession({ storage: createMemoryTokenStorage(), baseUrl: server.url });
  expect((await session.start()).status).toBe('authenticated');
  const gameClient = createGameClient(session, { serverUrl: server.url });
  const roomStore = createRoomStore();
  const tableStore = createTableStore();
  let rooms: RoomService | null = null;
  const table = createTableController({ store: tableStore, send: (m) => rooms?.send(m) ?? false });
  const p: Player = {
    session,
    gameClient,
    rooms: undefined as never,
    roomStore,
    tableStore,
    table,
    controller: undefined as never,
    seqs: [],
    desyncs: 0,
    errors: [],
    phases: [],
    seenPublic: new Set(),
    seenPrivate: new Set(),
    firstHand: [],
    actionsOutOfTurn: [],
    rawStates: 0,
  };
  // Sorvedouro que registra o que chega e repassa ao controlador real.
  const sink = {
    ...table,
    applyState(json: unknown) {
      p.rawStates += 1;
      const state = json as {
        game?: { handNumber?: number };
        hand?: { turn?: number };
        privates?: Record<string, { seat?: number; legalActions?: string[] }>;
      };
      if (state.game?.handNumber === 1) scan(json, false, p.seenPublic, p.seenPrivate);
      for (const mine of Object.values(state.privates ?? {})) {
        if (
          (mine.legalActions?.length ?? 0) > 0 &&
          state.hand?.turn !== mine.seat &&
          state.hand?.turn !== undefined
        ) {
          p.actionsOutOfTurn.push(`seat ${String(mine.seat)} turn ${String(state.hand.turn)}`);
        }
      }
      table.applyState(json);
    },
    onEvent(env: EventEnvelope) {
      p.seqs.push(env.seq);
      table.onEvent(env);
    },
    onDesync(info: { expected: number; got: number }) {
      p.desyncs += 1;
      table.onDesync(info);
    },
    onServerError(payload: unknown) {
      p.errors.push(String((payload as { code?: unknown }).code));
      table.onServerError(payload);
    },
  };
  rooms = createRoomService({
    store: roomStore,
    table: sink,
    getClient: () => ({
      joinWithReservation: async (r) =>
        (await gameClient.joinWithReservation(r)) as unknown as RoomLike,
      reconnect: async (s) => (await gameClient.reconnect(s)) as unknown as RoomLike,
    }),
  });
  p.rooms = rooms;
  p.controller = createLobbyController({
    api: session.api,
    store: createLobbyStore(),
    enter: (r) => rooms.enter(r),
    onEntered: () => undefined,
    pollMs: 100,
  });
  roomStore.subscribe((s) => {
    if (p.phases[p.phases.length - 1] !== s.tablePhase && s.tablePhase !== '') {
      p.phases.push(s.tablePhase);
    }
  });
  tableStore.subscribe((s) => {
    if (p.firstHand.length === 0 && s.vm?.handNumber === 1 && s.vm.myHand.length > 0) {
      p.firstHand = s.vm.myHand.map(key);
    }
  });
  return p;
}

async function waitFor(pred: () => boolean, label: string, ms = 20_000): Promise<void> {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function disposePlayers(): Promise<void> {
  for (const p of players) {
    p.controller.dispose();
    await p.rooms.leave();
    p.gameClient.dispose();
    p.session.dispose();
  }
  players = [];
}

/** 4 jogadores sentados numa mesa privada recém-criada; a partida já começou. */
async function seatedAndPlaying(): Promise<Player[]> {
  players = await Promise.all([0, 1, 2, 3].map(() => newPlayer()));
  const [owner, ...others] = players as [Player, Player, Player, Player];
  let code = '';
  const ownerCtl = createLobbyController({
    api: owner.session.api,
    store: createLobbyStore(),
    enter: (r) => owner.rooms.enter(r),
    onEntered: (c) => (code = c),
    pollMs: 100,
  });
  await ownerCtl.createTable({ variant: 'paulista', format: 'single', ironHand: true });
  expect(code).toMatch(/^[A-Z2-9]{8}$/);
  for (const o of others) await o.controller.joinByCode(code);
  await waitFor(
    () => players.every((p) => p.tableStore.getState().vm?.phase === 'playing'),
    'todos veem a partida em andamento',
  );
  await waitFor(
    () => players.every((p) => (p.tableStore.getState().vm?.myHand.length ?? 0) === 3),
    'todos com 3 cartas',
  );
  return players;
}

beforeAll(async () => {
  server = await startServer();
}, 30_000);

afterEach(async () => {
  await disposePlayers();
});

afterAll(async () => {
  await server?.stop();
});

describe('mesa jogável contra o servidor real', () => {
  it('4 convidados jogam uma mão inteira com a primeira ação legal (sem apostar)', async () => {
    const ps = await seatedAndPlaying();
    const roomsAtStart = ps.map((p) => p.rooms.current());

    // Motor do teste: a cada estado, quem pode agir joga a primeira ação legal que não é apostar.
    // Cadência humana: o servidor recusa ações do mesmo assento com menos de 150 ms de intervalo.
    const GAP_MS = 220;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const drive = ps.map((p) => {
      let lastAct = 0;
      let waiting = false;
      const step = (): void => {
        const st = p.tableStore.getState();
        const vm = st.vm;
        if (p.errors.length > 0) return; // nunca insiste depois de um erro
        if (vm === null || vm.phase !== 'playing' || !vm.canAct || st.busy || waiting) return;
        const first = vm.legalActions.find((a) => a !== 'bet');
        if (first === undefined) return;
        const wait = lastAct + GAP_MS - Date.now();
        if (wait > 0) {
          waiting = true;
          timers.push(
            setTimeout(() => {
              waiting = false;
              step();
            }, wait),
          );
          return;
        }
        lastAct = Date.now();
        p.table.act(first);
      };
      step();
      return p.tableStore.subscribe(step);
    });
    await waitFor(
      () => ps.every((p) => p.tableStore.getState().history.length >= 1),
      'handDecided recebido por todos',
    );
    for (const off of drive) off();
    for (const t of timers) clearTimeout(t);

    // Mesma sala do começo ao fim (waiting -> playing não larga a sala).
    ps.forEach((p, i) => expect(p.rooms.current()).toBe(roomsAtStart[i]));
    for (const p of ps) {
      expect(p.roomStore.getState().connection).toBe('connected');
      expect(p.phases.at(-1)).toBe('playing');
    }

    // seq contínuo, sem desync, sem erro nenhum e offset do relógio calculado.
    for (const p of ps) {
      expect(p.seqs.length).toBeGreaterThan(8);
      p.seqs.forEach((s, i) => {
        if (i > 0) expect(s).toBe((p.seqs[i - 1] as number) + 1);
      });
      expect(p.desyncs).toBe(0);
      expect(p.errors).toEqual([]);
      expect(p.tableStore.getState().lastSeq).toBe(p.seqs.at(-1));
      expect(Math.abs(p.tableStore.getState().clockOffsetMs)).toBeLessThan(2000);
      expect(p.tableStore.getState().history[0]).toMatchObject({ handNumber: 1 });
    }

    // legalActions só no assento da vez (varredura de TODOS os estados brutos).
    for (const p of ps) expect(p.actionsOutOfTurn).toEqual([]);

    // Ninguém vê carta alheia: tudo que um cliente viu fora do próprio bloco privado é público (jogado/vira).
    expect(ps.every((p) => p.firstHand.length === 3)).toBe(true);
    const played = new Set<string>();
    for (const p of ps) for (const c of p.seenPublic) played.add(c);
    for (const a of ps) {
      const own = new Set(a.firstHand);
      for (const b of ps) {
        if (a === b) continue;
        for (const card of b.firstHand) {
          if (own.has(card)) continue;
          // A carta de B só pode aparecer para A se estiver em área pública (foi jogada).
          expect(a.seenPrivate.has(card)).toBe(false);
          if (a.seenPublic.has(card)) expect(played.has(card)).toBe(true);
        }
      }
      // O bloco privado do cliente só tem a mão dele (mão 1).
      for (const c of a.seenPrivate) expect(own.has(c)).toBe(true);
    }
    // E o que o cliente guarda no store também: só handSize dos outros.
    for (const p of ps) {
      const vm = p.tableStore.getState().vm!;
      for (const s of vm.seats) expect(Object.keys(s)).not.toContain('hand');
    }
  }, 60_000);

  it('envio fora de turno recebe erro tipado (e 5 envios seguidos só geram códigos do protocolo)', async () => {
    const ps = await seatedAndPlaying();
    const idle = ps.find((p) => {
      const vm = p.tableStore.getState().vm!;
      return vm.turnSeat !== vm.mySeat;
    })!;
    const card = idle.tableStore.getState().vm!.myHand[0]!;
    const before = JSON.stringify(idle.tableStore.getState().vm!.current);
    // Direto no serviço (a UI nunca envia isto): é o servidor quem recusa.
    for (let i = 0; i < 5; i++) {
      idle.rooms.send({
        type: 'play',
        card: { rank: card.rank as never, suit: card.suit as never },
      });
    }
    await waitFor(() => idle.errors.length >= 5, 'cinco erros tipados');
    expect(idle.errors[0]).toBe('NOT_YOUR_TURN');
    for (const code of idle.errors)
      expect((ERROR_CODES as readonly string[]).includes(code)).toBe(true);
    expect(idle.tableStore.getState().errorCode).not.toBeNull();
    // O estado não mudou e a sala segue conectada.
    expect(JSON.stringify(idle.tableStore.getState().vm!.current)).toBe(before);
    expect(idle.roomStore.getState().connection).toBe('connected');
    // Os outros não receberam erro nenhum.
    for (const p of ps) if (p !== idle) expect(p.errors).toEqual([]);
  }, 40_000);

  it('o controlador não envia ação fora de legalActions, nem na vez de outro', async () => {
    const ps = await seatedAndPlaying();
    const idle = ps.find((p) => {
      const vm = p.tableStore.getState().vm!;
      return vm.turnSeat !== vm.mySeat;
    })!;
    const vm = idle.tableStore.getState().vm!;
    expect(vm.legalActions).toEqual([]);
    const card = vm.myHand[0]!;
    expect(idle.table.act(`play:${card.rank}${card.suit}`)).toBe(false);
    expect(idle.table.act('bet')).toBe(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(idle.errors).toEqual([]);
  }, 40_000);
});
