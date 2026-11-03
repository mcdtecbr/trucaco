/**
 * Integração da mesa (3H1) contra o servidor REAL (`apps/server/dist/main.js`) com as peças reais do
 * cliente: sessão, cliente Colyseus, `roomService`, `tableController` e `tableStore`. 4 convidados entram
 * por código e cada um joga uma mão inteira: pede truco uma vez (quando pode), responde aceitando e
 * escolhe a primeira ação legal que não seja apostar.
 * Rode com `pnpm --filter @trucaco/mobile test:int` (precisa de `pnpm build` antes).
 */
import { CloseCode } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
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
import type { TokenStorage } from '../net/tokenStorageCore';
import { createRoomService } from '../room/roomService';
import type { RoomLike, RoomService } from '../room/roomService';
import { createLobbyStore } from '../store/lobbyStore';
import { createRoomStore } from '../store/roomStore';
import type { RoomStore } from '../store/roomStore';
import { createClockOffset } from './clockOffset';
import { createTableController } from './tableController';
import type { EventEnvelope, TableController } from './tableController';
import { createTableStore } from './tableStore';
import type { TableStore } from './tableStore';

interface Player {
  storage: TokenStorage;
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
  /** Estados em que havia `legalActions` para quem não é o `actingSeat` (exceto decisão especial). */
  actionsOutOfTurn: string[];
  /** Estados vistos com aposta pendente em que este jogador tinha ação legal (e era o actingSeat). */
  pendingActed: number;
  /** Cartas jogadas segundo os EVENTOS públicos (fonte independente do estado). */
  playedByEvents: Set<string>;
  rawStates: number;
  /** Gancho antes de cada `reconnect` manual (o teste de replay gera eventos durante a queda). */
  beforeReconnect: (() => Promise<void>) | null;
  /** Quantas amostras entraram no estimador de offset do relógio (replay não pode somar). */
  offsetSamples: number;
  /** `matchNumber` e pé (`game.pe`) de cada estado bruto, sem repetição consecutiva. */
  pes: { match: number; pe: number }[];
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
  const storage = createMemoryTokenStorage();
  const session = createSession({ storage, baseUrl: server.url });
  expect((await session.start()).status).toBe('authenticated');
  const gameClient = createGameClient(session, { serverUrl: server.url });
  const roomStore = createRoomStore();
  const tableStore = createTableStore();
  let rooms: RoomService | null = null;
  const realOffset = createClockOffset();
  let countSample: () => void = () => undefined;
  const table = createTableController({
    store: tableStore,
    send: (m) => rooms?.send(m) ?? false,
    clockOffset: {
      ...realOffset,
      add(serverAt, clientNow) {
        countSample();
        return realOffset.add(serverAt, clientNow);
      },
    },
  });
  const p: Player = {
    storage,
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
    pendingActed: 0,
    playedByEvents: new Set(),
    rawStates: 0,
    beforeReconnect: null,
    offsetSamples: 0,
    pes: [],
  };
  // Sorvedouro que registra o que chega e repassa ao controlador real.
  const sink = {
    ...table,
    applyState(json: unknown) {
      p.rawStates += 1;
      const state = json as {
        game?: { handNumber?: number };
        hand?: { phase?: string; actingSeat?: number; specialTeam?: number };
        privates?: Record<string, { seat?: number; legalActions?: string[] }>;
      };
      const rawState = json as { matchNumber?: number; game?: { pe?: number } };
      const lastPe = p.pes.at(-1);
      const curPe = { match: rawState.matchNumber ?? 1, pe: rawState.game?.pe ?? -1 };
      if (lastPe?.match !== curPe.match || lastPe.pe !== curPe.pe) p.pes.push(curPe);
      if (state.game?.handNumber === 1) scan(json, false, p.seenPublic, p.seenPrivate);
      for (const mine of Object.values(state.privates ?? {})) {
        if ((mine.legalActions?.length ?? 0) === 0 || mine.seat === undefined) continue;
        const h = state.hand;
        // Em decisão especial os DOIS da dupla que decide têm ação; fora disso só o actingSeat (ou a dupla dele).
        const okSpecial = h?.phase === 'specialDecision' && mine.seat % 2 === h.specialTeam;
        // Aposta pendente: só o respondedor (= actingSeat) tem ação; onze/dez: os dois da dupla.
        if (h?.actingSeat !== mine.seat && !okSpecial) {
          p.actionsOutOfTurn.push(
            `seat ${mine.seat} acting ${String(h?.actingSeat)} ${String(h?.phase)} ${(mine.legalActions ?? []).join(',')}`,
          );
        }
        if (h?.phase === 'betPending' && h.actingSeat === mine.seat) p.pendingActed += 1;
      }
      table.applyState(json);
    },
    onEvent(env: EventEnvelope) {
      p.seqs.push(env.seq);
      const ev = env.event as { type?: string; card?: { rank: string; suit: string } | null };
      if (ev.type === 'cardPlayed' && ev.card) p.playedByEvents.add(key(ev.card));
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
      reconnect: async (s) => {
        await p.beforeReconnect?.();
        return (await gameClient.reconnect(s)) as unknown as RoomLike;
      },
    }),
  });
  countSample = () => {
    p.offsetSamples += 1;
  };
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
async function seatedAndPlaying(beforeSeat?: (ps: Player[]) => Promise<void>): Promise<Player[]> {
  players = await Promise.all([0, 1, 2, 3].map(() => newPlayer()));
  await beforeSeat?.(players);
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
      let bet = false;
      const step = (): void => {
        const st = p.tableStore.getState();
        const vm = st.vm;
        if (p.errors.length > 0) return; // nunca insiste depois de um erro
        if (vm === null || vm.phase !== 'playing' || !vm.canAct || st.busy || waiting) return;
        // Aposta pendente: quem responde é o actingSeat (a UI usa o mesmo critério).
        if (vm.handPhase === 'betPending' && vm.actingSeat !== vm.mySeat) return;
        // Pede truco uma vez (só na jogada normal); depois responde aceitando.
        const wantsBet = !bet && vm.handPhase === 'playing' && vm.legalActions.includes('bet');
        const first = wantsBet ? 'bet' : vm.legalActions.find((a) => a !== 'bet');
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
        if (wantsBet) bet = true;
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
      expect(p.seqs.length).toBeGreaterThan(0);
      expect(Math.abs(p.tableStore.getState().clockOffsetMs)).toBeLessThan(2000);
      expect(p.tableStore.getState().history[0]).toMatchObject({ handNumber: 1 });
    }

    // legalActions só no actingSeat (varredura de TODOS os estados brutos), e houve aposta pendente.
    for (const p of ps) expect(p.actionsOutOfTurn).toEqual([]);
    expect(ps.reduce((n, p) => n + p.pendingActed, 0)).toBeGreaterThan(0);

    // Ninguém vê carta alheia: tudo que um cliente viu fora do próprio bloco privado é público (jogado/vira).
    expect(ps.every((p) => p.firstHand.length === 3)).toBe(true);
    // Cartas jogadas, segundo os eventos públicos (independente do que o estado mostrou).
    const played = new Set<string>();
    for (const p of ps) for (const c of p.playedByEvents) played.add(c);
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
      return !vm.canAct;
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
      return !vm.canAct;
    })!;
    const vm = idle.tableStore.getState().vm!;
    expect(vm.legalActions).toEqual([]);
    const card = vm.myHand[0]!;
    expect(idle.table.act(`play:${card.rank}${card.suit}`)).toBe(false);
    expect(idle.table.act('bet')).toBe(false);
    await new Promise((r) => setTimeout(r, 300));
    expect(idle.errors).toEqual([]);
  }, 40_000);

  it('replay de reconexão: eventos velhos não entram no offset do relógio nem refazem anúncios', async () => {
    const ps = await seatedAndPlaying();
    const actor1 = ps.find((p) => p.tableStore.getState().vm?.canAct === true)!;
    // Ordem de jogo por assento: o terceiro a jogar não age nas duas primeiras cartas.
    const victim = ps.find(
      (p) =>
        p.tableStore.getState().vm!.mySeat === (actor1.tableStore.getState().vm!.mySeat + 2) % 4,
    )!;
    const announced: string[] = [];
    victim.table.setAnnouncer((m) => announced.push(m));

    // Controle: um evento AO VIVO mede o relógio e é anunciado (prova que a fiação funciona).
    const card1 = actor1.tableStore.getState().vm!.legalActions.find((a) => a.startsWith('play:'))!;
    expect(actor1.table.act(card1)).toBe(true);
    await waitFor(() => announced.length > 0, 'anúncio ao vivo da primeira carta');
    const liveSeqs = victim.seqs.length;
    const announcedLive = announced.length;

    // O próximo a jogar DURANTE a queda: quem tem `play:` em legalActions (não a vítima nem o primeiro).
    // O replay sai velho (> 2 s).
    const canPlay = (p: Player): boolean =>
      p.tableStore.getState().vm?.legalActions.some((a) => a.startsWith('play:')) === true &&
      !p.tableStore.getState().busy;
    const others = ps.filter((p) => p !== victim && p !== actor1);
    await waitFor(() => others.some(canPlay), 'próximo jogador tem carta legal');
    const actor2 = others.find(canPlay)!;
    const seqBeforeGap = victim.seqs.at(-1)!;
    victim.beforeReconnect = async () => {
      victim.beforeReconnect = null; // roda uma vez só
      await new Promise((r) => setTimeout(r, 300)); // respeita o intervalo mínimo entre ações
      const card2 = actor2.tableStore
        .getState()
        .vm!.legalActions.find((a) => a.startsWith('play:'))!;
      expect(actor2.table.act(card2)).toBe(true);
      await waitFor(() => actor2.seqs.at(-1)! > seqBeforeGap, 'o evento da queda foi publicado');
      await new Promise((r) => setTimeout(r, 2400)); // envelhece o evento além de REPLAY_MIN_AGE_MS
    };

    const room = victim.rooms.current() as unknown as Room;
    const offsetBefore = victim.tableStore.getState().clockOffsetMs;
    const samplesBefore = victim.offsetSamples;
    // Depende de internos do SDK (@colyseus/sdk 0.18.9): `room.reconnection.enabled = false` desliga a
    // reconexão automática e `room.connection.close(MAY_TRY_RECONNECT)` simula a queda sem consentimento,
    // o que leva o roomService ao caminho manual (`recover` -> client.reconnect). Se o SDK mudar, ajustar aqui.
    room.reconnection.enabled = false;
    room.connection.close(CloseCode.MAY_TRY_RECONNECT);

    const why = (): string =>
      `conexão ${victim.roomStore.getState().connection}, erro ${String(victim.roomStore.getState().errorCode)}, errors ${victim.errors.join(',')}`;
    await waitFor(
      () =>
        victim.rooms.current() !== room && victim.roomStore.getState().connection === 'connected',
      'reconectou: ' + why(),
      30_000,
    ).catch((e: unknown) => {
      throw new Error(`${String(e)} | ${why()}`);
    });
    await waitFor(() => victim.seqs.length > liveSeqs, 'replay entregue');
    await new Promise((r) => setTimeout(r, 300));

    // O replay chegou (seq contínuo, sem salto) ...
    expect(victim.desyncs).toBe(0);
    victim.seqs.forEach((s, i) => {
      if (i > 0) expect(s).toBe(victim.seqs[i - 1]! + 1);
    });
    expect(victim.rooms.current()).not.toBe(room);
    expect(victim.roomStore.getState().connection).toBe('connected');
    // ... mas não mexeu no offset do relógio nem foi anunciado de novo.
    expect(victim.tableStore.getState().clockOffsetMs).toBe(offsetBefore);
    // Prova direta: nenhuma amostra nova entrou no estimador (a mediana poderia mascarar uma).
    expect(victim.offsetSamples).toBe(samplesBefore);
    // Só a carta ao vivo foi falada; a do replay não. (Presença, 'X voltou', é outro canal e é falada.)
    expect(announced.filter((m) => m.includes('jogou'))).toHaveLength(1);
    expect(announced.length).toBeGreaterThanOrEqual(announcedLive);
    // O estado reprojetado mostra as duas cartas na mesa (a fonte de verdade é o estado).
    expect(victim.tableStore.getState().vm!.current.length).toBeGreaterThanOrEqual(2);
    expect(victim.errors).toEqual([]);
    victim.beforeReconnect = null;
  }, 60_000);
});

describe('revanche contra o servidor real', () => {
  it('série decidida em uma mão: todos votam, matchNumber 2, mesa volta a jogar com o pé rodado', async () => {
    const ps = await seatedAndPlaying();
    // Motor: pede/aumenta a aposta sempre que pode e aceita; a mão sobe até 12 e decide o jogo (e a série).
    const GAP_MS = 220;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const drive = ps.map((p) => {
      let lastAct = 0;
      let waiting = false;
      const step = (): void => {
        const st = p.tableStore.getState();
        const vm = st.vm;
        if (p.errors.length > 0) return;
        if (vm === null || vm.phase !== 'playing' || !vm.canAct || st.busy || waiting) return;
        if (vm.matchNumber !== 1) return;
        if (vm.handPhase === 'betPending' && vm.actingSeat !== vm.mySeat) return;
        const first = vm.legalActions.includes('bet')
          ? 'bet'
          : (vm.legalActions.find((a) => a === 'accept') ?? vm.legalActions[0]);
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
      () => ps.every((p) => p.tableStore.getState().vm?.rematchOpen === true),
      'janela de revanche aberta para todos',
      90_000,
    );
    for (const off of drive) off();
    for (const t of timers) clearTimeout(t);
    for (const p of ps) {
      const vm = p.tableStore.getState().vm!;
      expect(vm.matchNumber).toBe(1);
      expect(vm.rematchVotes).toEqual([]);
      expect(vm.rematchDeadlineAt).toBeGreaterThan(0);
    }
    const lastPe = ps[0]!.pes.filter((x) => x.match === 1).at(-1)!.pe;
    const history1 = ps[0]!.tableStore.getState().history.length;
    expect(history1).toBeGreaterThan(0);

    // O servidor exige 150 ms entre ações do mesmo assento: quem jogou a última carta espera um pouco.
    await new Promise((r) => setTimeout(r, 400));
    // Todos votam (o controlador envia; um segundo voto é barrado no cliente).
    for (const p of ps) {
      expect(p.table.voteRematch()).toBe(true);
      expect(p.table.voteRematch()).toBe(false);
    }
    await waitFor(
      () => ps.every((p) => p.tableStore.getState().vm?.matchNumber === 2),
      'matchNumber 2 em todos',
    );
    await waitFor(
      () => ps.every((p) => p.tableStore.getState().vm?.phase === 'playing'),
      'mesa volta a jogar',
    );
    for (const p of ps) {
      const s = p.tableStore.getState();
      expect(s.vm?.rematchOpen).toBe(false);
      expect(s.vm?.rematchDeadlineAt).toBe(0);
      expect(s.vm?.rematchVotes).toEqual([]);
      expect(s.vm?.scores).toEqual([0, 0]);
      expect(s.vm?.series.winnerTeam).toBe(-1);
      expect(p.roomStore.getState().connection).toBe('connected');
      expect(p.desyncs).toBe(0);
      expect(p.errors).toEqual([]);
      p.seqs.forEach((q, i) => {
        if (i > 0) expect(q).toBe(p.seqs[i - 1]! + 1);
      });
    }
    // Rodízio do pé: o pé da primeira mão da partida 2 é o seguinte ao da última mão da partida 1.
    const firstPe2 = ps[0]!.pes.find((x) => x.match === 2)!.pe;
    expect(firstPe2).toBe((lastPe + 1) % 4);
  }, 150_000);
});

describe('4E/4F: sinais e avatar contra o servidor real', () => {
  it('sinal de um jogador aparece nos 4 (inclusive no emissor) em menos de 500 ms; o seguinte, antes do cooldown, é recusado', async () => {
    const ps = await seatedAndPlaying();
    const sender = ps[0]!;
    const seat = sender.tableStore.getState().vm!.mySeat;
    const t0 = Date.now();
    expect(sender.table.sendSignal('wink')).toBe(true);
    await waitFor(
      () => ps.every((p) => p.tableStore.getState().signals[seat]?.id === 'wink'),
      'sinal chega aos 4',
      2000,
    );
    expect(Date.now() - t0).toBeLessThan(500);
    // Cooldown de 3 s por assento: o segundo sinal volta como RATE_LIMITED só para o emissor.
    expect(sender.table.sendSignal('nod')).toBe(true);
    await waitFor(() => sender.errors.includes('RATE_LIMITED'), 'RATE_LIMITED do cooldown', 3000);
    for (const p of ps) if (p !== sender) expect(p.errors).toEqual([]);
    // O servidor não manda sinal fora do catálogo; o controlador também nem envia.
    expect(sender.table.sendSignal('inventado')).toBe(false);
  }, 40_000);

  it('avatar salvo por PUT /me/avatar vale para a mesa e sobrevive a um novo login', async () => {
    const chosen = {
      face_shape: 1,
      skin: 3,
      hair: 6,
      eyes: 2,
      mouth: 1,
      outfit: 4,
      accessory: 2,
      bg_color: 5,
      hair_color: 4,
      eye_color: 2,
      outfit_color: 9,
    };
    const ps = await seatedAndPlaying(async (all) => {
      const s = all[1]!.session;
      // Inválido é recusado e não altera nada.
      await expect(s.api.updateAvatar({ ...chosen, hair: 99 })).rejects.toMatchObject({
        status: 400,
        code: 'INVALID_AVATAR',
      });
      expect((await s.api.updateAvatar(chosen)).avatar).toEqual(chosen);
    });
    const target = ps[1]!;
    const seat = target.tableStore.getState().vm!.mySeat;
    // Os outros 3 veem as partes escolhidas no assento dele.
    for (const p of ps) {
      expect(p.tableStore.getState().vm!.seats[seat]!.avatar).toEqual(chosen);
    }
    // Novo login (mesmo armazenamento): GET /me devolve o avatar.
    const again = createSession({ storage: target.storage, baseUrl: server.url });
    try {
      expect((await again.start()).status).toBe('authenticated');
      expect((await again.api.me()).avatar).toEqual(chosen);
    } finally {
      again.dispose();
    }
  }, 40_000);
});
