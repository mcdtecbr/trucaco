/**
 * Projeção do `SeriesState` do motor para o schema da mesa, com visão filtrada por assento.
 *
 * Duas etapas:
 * 1. Funções puras (`sharedSnapshot`, `privateSnapshot`) calculam, a partir de `viewFor`/
 *    `legalActions`/`pendingSeat` do motor, o que cada parte do schema deve conter. Nunca leem
 *    `HandState.hands` diretamente: a única fonte de cartas é `viewFor`.
 * 2. `projectState` aplica os snapshots ao schema, mutando só o que mudou.
 *
 * Cartas cobertas: o estado compartilhado nunca traz a identidade; o dono a recebe em
 * `privates[seat].ownCovered`. Carta às cegas (mão de ferro) é pública depois de jogada.
 */
import type { Card } from '@trucaco/protocol';
import { isSeriesOver, legalActions, manilhaRank, pendingSeat, viewFor } from '@trucaco/rules';
import type { HandAction, HandView, PlayedCardView, SeriesState, Seat, Team } from '@trucaco/rules';
import type { ArraySchema } from '@colyseus/schema';
import {
  CardSchema,
  OwnCoveredSchema,
  PendingBetSchema,
  PlayedCardSchema,
  TrickSchema,
} from './schema';
import type { SeatPrivateNode, TableState } from './schema';

// ---------------------------------------------------------------- ids de ação

/** Id de ação exposto ao cliente. `callBet` e `raiseBet` são ambos `bet` (a fase distingue). */
export function actionId(a: HandAction): string {
  switch (a.type) {
    case 'playCard':
      return `${a.covered === true ? 'playCovered' : 'play'}:${a.card.rank}${a.card.suit}`;
    case 'playBlindCard':
      return `playBlind:${a.index}`;
    case 'callBet':
    case 'raiseBet':
      return 'bet';
    case 'acceptBet':
      return 'accept';
    case 'runBet':
      return 'run';
    case 'playSpecial':
      return 'specialPlay';
    case 'runSpecial':
      return 'specialRun';
  }
}

/** Ids das ações legais do assento, sem repetição, na ordem do motor. */
export function legalActionIds(series: SeriesState, seat: Seat): string[] {
  const ids: string[] = [];
  for (const a of legalActions(series, seat)) {
    const id = actionId(a);
    if (!ids.includes(id)) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------- snapshots puros

export interface PlaySnapshot {
  readonly seat: Seat;
  readonly covered: boolean;
  /** null: coberta (identidade escondida). */
  readonly card: Card | null;
}

export interface TrickSnapshot {
  readonly starter: Seat;
  readonly winnerSeat: number;
  readonly winnerTeam: number;
  readonly plays: readonly PlaySnapshot[];
}

export interface SharedSnapshot {
  readonly phase: 'playing' | 'finished';
  readonly series: {
    readonly format: string;
    readonly games: readonly [number, number];
    readonly gameNumber: number;
    readonly winnerTeam: number;
  };
  readonly game: {
    readonly scores: readonly [number, number];
    readonly handNumber: number;
    readonly pe: Seat;
  };
  readonly hand: {
    readonly vira: Card | null;
    readonly manilhaRank: string;
    readonly manilhaCards: readonly string[];
    readonly nextBetValue: number;
    readonly pendingValue: number;
    readonly special: string;
    readonly specialTeam: number;
    readonly phase: string;
    readonly turn: Seat;
    /** `pendingSeat` do motor (o mesmo do timer de turno); -1 se ninguém age. */
    readonly actingSeat: number;
    readonly value: number;
    readonly level: number;
    readonly pending: {
      readonly fromSeat: Seat;
      readonly fromTeam: Team;
      readonly toLevel: number;
    } | null;
    readonly tricks: readonly TrickSnapshot[];
    readonly current: readonly PlaySnapshot[];
  };
  readonly handSizes: readonly number[];
}

export interface OwnCoveredSnapshot {
  /** Índice da vaza, ou -1 se ainda em `current`. */
  readonly trick: number;
  readonly card: Card;
}

export interface PrivateSnapshot {
  readonly hand: readonly Card[];
  readonly legalActions: readonly string[];
  readonly partnerCards: readonly Card[];
  readonly ownCovered: readonly OwnCoveredSnapshot[];
}

function plain(c: Card): Card {
  return { rank: c.rank, suit: c.suit };
}

/** Jogada pública: coberta nunca tem identidade, de ninguém. */
function publicPlay(p: PlayedCardView): PlaySnapshot {
  return {
    seat: p.seat,
    covered: p.covered,
    card: p.covered || p.card === null ? null : plain(p.card),
  };
}

/**
 * Valores de aposta a partir da escada do motor (`variant.betLadder`, indexada por `level`).
 * `pendingValue`: degrau de `pending.toLevel`. `nextBetValue`: degrau seguinte ao pendente (aumento)
 * ou ao nível atual (pedido); 0 se a escada acabou ou a mão não aceita aposta agora.
 */
function betValues(
  ladder: readonly number[],
  v: HandView,
): { nextBetValue: number; pendingValue: number } {
  const pendingValue = v.pending === null ? 0 : (ladder[v.pending.toLevel] ?? 0);
  const open = v.phase === 'playing' || v.phase === 'betPending';
  const base = v.pending === null ? v.level : v.pending.toLevel;
  return { nextBetValue: open ? (ladder[base + 1] ?? 0) : 0, pendingValue };
}

/** O que todos os assentos veem. Independe do assento (usa a visão do 0 e mascara as cobertas). */
export function sharedSnapshot(series: SeriesState): SharedSnapshot {
  const hand = series.match.hand;
  const v: HandView = viewFor(hand, 0);
  const winnerTeam = series.cancelled ? -1 : (series.winner ?? -1);
  return {
    phase: series.winner !== null || series.cancelled ? 'finished' : 'playing',
    series: {
      format: series.config.format,
      games: [series.games[0], series.games[1]],
      gameNumber: series.gameNumber,
      winnerTeam,
    },
    game: {
      scores: [series.match.scores[0], series.match.scores[1]],
      handNumber: series.match.handNumber,
      pe: series.match.pe,
    },
    hand: {
      vira: v.vira === null ? null : plain(v.vira),
      manilhaRank: manilhaRank(hand.variant, v.vira) ?? '',
      manilhaCards: (hand.variant.fixedManilhas ?? []).map((c) => `${c.rank}${c.suit}`),
      ...betValues(hand.variant.betLadder, v),
      special: v.special,
      specialTeam: v.specialTeam ?? -1,
      phase: v.phase,
      turn: v.turn,
      actingSeat: isSeriesOver(series) ? -1 : (pendingSeat(series) ?? -1),
      value: v.value,
      level: v.level,
      pending: v.pending === null ? null : { ...v.pending },
      tricks: v.tricks.map((t) => ({
        starter: t.starter,
        winnerSeat: t.winnerSeat ?? -1,
        winnerTeam: t.winnerTeam ?? -1,
        plays: t.plays.map(publicPlay),
      })),
      current: v.current.map(publicPlay),
    },
    handSizes: [...v.handSizes],
  };
}

/** O que só o assento `seat` pode ver: mão, ações legais, mão do parceiro (onze/dez), próprias cobertas. */
export function privateSnapshot(series: SeriesState, seat: Seat): PrivateSnapshot {
  const v: HandView = viewFor(series.match.hand, seat);
  const ownCovered: OwnCoveredSnapshot[] = [];
  const collect = (plays: readonly PlayedCardView[], trick: number): void => {
    for (const p of plays) {
      if (p.covered && p.seat === seat && p.card !== null) {
        ownCovered.push({ trick, card: plain(p.card) });
      }
    }
  };
  v.tricks.forEach((t, i) => collect(t.plays, i));
  collect(v.current, -1);
  return {
    hand: (v.ownHand ?? []).map(plain),
    legalActions: legalActionIds(series, seat),
    partnerCards: Object.values(v.partnerHands).flatMap((cards) => cards.map(plain)),
    ownCovered,
  };
}

/** Atalho: o conteúdo privado do assento (equivale ao que o cliente recebe em `privates[seat]`). */
export function viewIdsFor(series: SeriesState, seat: Seat): PrivateSnapshot {
  return privateSnapshot(series, seat);
}

// ---------------------------------------------------------------- aplicação no schema

function setIf<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  if (target[key] !== value) target[key] = value;
}

/** Ajusta `arr` para ter exatamente os `items`, reaproveitando nós e mexendo só no que mudou. */
function syncList<N, S>(
  arr: ArraySchema<N>,
  items: readonly S[],
  create: () => N,
  update: (node: N, item: S) => void,
): void {
  items.forEach((item, i) => {
    let node = arr[i];
    if (node === undefined) {
      node = create();
      update(node, item);
      arr.push(node);
    } else {
      update(node, item);
    }
  });
  while (arr.length > items.length) arr.pop();
}

function syncStrings(arr: ArraySchema<string>, items: readonly string[]): void {
  items.forEach((s, i) => {
    if (i >= arr.length) arr.push(s);
    else if (arr[i] !== s) arr[i] = s;
  });
  while (arr.length > items.length) arr.pop();
}

function syncNumbers(arr: ArraySchema<number>, items: readonly number[]): void {
  items.forEach((n, i) => {
    if (i >= arr.length) arr.push(n);
    else if (arr[i] !== n) arr[i] = n;
  });
  while (arr.length > items.length) arr.pop();
}

type PlayNode = InstanceType<typeof PlayedCardSchema>;

function updatePlay(node: PlayNode, p: PlaySnapshot): void {
  setIf(node, 'seat', p.seat);
  setIf(node, 'covered', p.covered);
  setIf(node, 'rank', p.card?.rank ?? '');
  setIf(node, 'suit', p.card?.suit ?? '');
}

function syncCards(
  arr: ArraySchema<InstanceType<typeof CardSchema>>,
  cards: readonly Card[],
): void {
  syncList(
    arr,
    cards,
    () => new CardSchema(),
    (n, c) => {
      setIf(n, 'rank', c.rank);
      setIf(n, 'suit', c.suit);
    },
  );
}

function applyPrivate(node: SeatPrivateNode, snap: PrivateSnapshot): void {
  syncCards(node.hand, snap.hand);
  syncStrings(node.legalActions, snap.legalActions);
  syncCards(node.partnerCards, snap.partnerCards);
  syncList(
    node.ownCovered,
    snap.ownCovered,
    () => new OwnCoveredSchema(),
    (n, c) => {
      setIf(n, 'trick', c.trick);
      setIf(n, 'rank', c.card.rank);
      setIf(n, 'suit', c.card.suit);
    },
  );
}

export interface ProjectionContext {
  /** Epoch ms em que o turno de `pendingSeat` expira; 0/ausente = sem prazo. */
  readonly turnDeadlineAt?: number;
}

/**
 * Atualiza o schema a partir do `SeriesState` (fonte da verdade). Idempotente. Não mexe em
 * `roomCode`, `options`, `players` (identidade/status) nem `cancelVotes`: são da sala.
 */
export function projectState(
  series: SeriesState,
  state: TableState,
  ctx: ProjectionContext = {},
): void {
  const shared = sharedSnapshot(series);
  setIf(state, 'phase', shared.phase);

  setIf(state.series, 'format', shared.series.format);
  setIf(state.series, 'gameNumber', shared.series.gameNumber);
  setIf(state.series, 'winnerTeam', shared.series.winnerTeam);
  syncNumbers(state.series.games, shared.series.games);

  syncNumbers(state.game.scores, shared.game.scores);
  setIf(state.game, 'handNumber', shared.game.handNumber);
  setIf(state.game, 'pe', shared.game.pe);

  const h = shared.hand;
  const hand = state.hand;
  setIf(hand, 'viraRank', h.vira?.rank ?? '');
  setIf(hand, 'viraSuit', h.vira?.suit ?? '');
  setIf(hand, 'manilhaRank', h.manilhaRank);
  syncStrings(hand.manilhaCards, h.manilhaCards);
  setIf(hand, 'nextBetValue', h.nextBetValue);
  setIf(hand, 'pendingValue', h.pendingValue);
  setIf(hand, 'special', h.special);
  setIf(hand, 'specialTeam', h.specialTeam);
  setIf(hand, 'phase', h.phase);
  setIf(hand, 'turn', h.turn);
  setIf(hand, 'actingSeat', h.actingSeat);
  setIf(hand, 'value', h.value);
  setIf(hand, 'level', h.level);
  if (h.pending === null) {
    if (hand.pending !== undefined) hand.pending = undefined;
  } else {
    const pending = hand.pending ?? new PendingBetSchema();
    setIf(pending, 'fromSeat', h.pending.fromSeat);
    setIf(pending, 'fromTeam', h.pending.fromTeam);
    setIf(pending, 'toLevel', h.pending.toLevel);
    if (hand.pending === undefined) hand.pending = pending;
  }
  syncList(
    hand.tricks,
    h.tricks,
    () => new TrickSchema(),
    (node, t) => {
      setIf(node, 'starter', t.starter);
      setIf(node, 'winnerSeat', t.winnerSeat);
      setIf(node, 'winnerTeam', t.winnerTeam);
      syncList(node.plays, t.plays, () => new PlayedCardSchema(), updatePlay);
    },
  );
  syncList(hand.current, h.current, () => new PlayedCardSchema(), updatePlay);

  state.players.forEach((p, seat) => {
    setIf(p, 'handSize', shared.handSizes[seat] ?? 0);
  });

  for (let seat = 0; seat < series.seats; seat++) {
    const node = state.privates.get(String(seat));
    if (node !== undefined) applyPrivate(node, privateSnapshot(series, seat));
  }

  const waiting = pendingSeat(series);
  setIf(state, 'turnDeadlineAt', waiting === null ? 0 : (ctx.turnDeadlineAt ?? 0));
}
