import type { Card } from './cards';
import { cardEquals, createDeck, deal, shuffle } from './deck';
import type { Rng } from './rng';
import { COVERED_STRENGTH, cardStrength } from './strength';
import { DEFAULT_SEATS, fail, nextSeat, ok, otherTeam, teamOf } from './types';
import type { Result, Seat, Team } from './types';
import type { Variant } from './variant';

/**
 * normal; maoDeOnze (limiar da variante: onze no Paulista, dez no Mineiro, uma dupla no limiar);
 * maoDeFerro (ambas no limiar).
 */
export type SpecialKind = 'normal' | 'maoDeOnze' | 'maoDeFerro';

export type HandPhase = 'specialDecision' | 'playing' | 'betPending' | 'finished';

export interface PlayedCard {
  readonly seat: Seat;
  readonly card: Card;
  readonly covered: boolean;
}

export interface Trick {
  readonly starter: Seat;
  readonly plays: readonly PlayedCard[];
  /** null em empate entre duplas. */
  readonly winnerSeat: Seat | null;
  readonly winnerTeam: Team | null;
}

export interface PendingBet {
  readonly fromSeat: Seat;
  readonly fromTeam: Team;
  /** Índice na escada de apostas que está sendo pedido. */
  readonly toLevel: number;
  /** Único assento que responde (aceitar, correr ou aumentar); o parceiro dele só assiste. */
  readonly responderSeat: Seat;
}

export type HandEndReason = 'tricks' | 'betRun' | 'specialRun' | 'draw';

/** Gancho para o MatchState: dupla vencedora (null = ninguém pontua) e pontos a somar. */
export interface HandOutcome {
  readonly winnerTeam: Team | null;
  readonly points: number;
  readonly reason: HandEndReason;
}

export interface HandState {
  readonly variant: Variant;
  readonly seats: number;
  /** Quem embaralha; o mão (primeiro a jogar) é o assento seguinte. */
  readonly pe: Seat;
  readonly vira: Card | null;
  /** hands[seat]: cartas ainda na mão. */
  readonly hands: readonly (readonly Card[])[];
  /** Placar do jogo no início da mão, por dupla. */
  readonly scores: readonly [number, number];
  readonly special: SpecialKind;
  /** Dupla que decide jogar/correr na mão de onze. */
  readonly specialTeam: Team | null;
  /** Mão de onze/dez: assentos da dupla que já aceitaram jogar (aceitar é definitivo). */
  readonly specialAccepted: readonly Seat[];
  /** Assento que fez o último pedido de aposta aceito (responde ao próximo aumento); null sem aposta. */
  readonly lastBetSeat: Seat | null;
  readonly phase: HandPhase;
  readonly tricks: readonly Trick[];
  readonly current: readonly PlayedCard[];
  readonly currentStarter: Seat;
  readonly turn: Seat;
  /** Valor atual da mão (última aposta aceita). */
  readonly value: number;
  /** Índice aceito na escada; -1 = valor base. */
  readonly level: number;
  readonly lastRaiserTeam: Team | null;
  readonly pending: PendingBet | null;
  readonly betsLocked: boolean;
  readonly result: HandOutcome | null;
}

export type HandAction =
  | {
      readonly type: 'playCard';
      readonly seat: Seat;
      readonly card: Card;
      readonly covered?: boolean;
    }
  /** Mão de ferro: joga a carta pela posição na mão, sem conhecê-la. */
  | { readonly type: 'playBlindCard'; readonly seat: Seat; readonly index: number }
  | { readonly type: 'callBet'; readonly seat: Seat }
  | { readonly type: 'acceptBet'; readonly seat: Seat }
  | { readonly type: 'raiseBet'; readonly seat: Seat }
  | { readonly type: 'runBet'; readonly seat: Seat }
  /** Mão de onze/dez: dupla na frente decide jogar. */
  | { readonly type: 'playSpecial'; readonly seat: Seat }
  /** Mão de onze/dez: dupla na frente corre. */
  | { readonly type: 'runSpecial'; readonly seat: Seat };

export interface StartHandFromCards {
  readonly variant: Variant;
  readonly seats?: number;
  readonly pe: Seat;
  readonly scores?: readonly [number, number];
  /** Mão de ferro quando as duas duplas estão no limiar (padrão true). */
  readonly ironHand?: boolean;
  readonly hands: readonly (readonly Card[])[];
  readonly vira: Card | null;
}

export interface StartHandParams {
  readonly variant: Variant;
  readonly seats?: number;
  readonly pe: Seat;
  readonly scores?: readonly [number, number];
  /** Mão de ferro quando as duas duplas estão no limiar (padrão true). */
  readonly ironHand?: boolean;
  readonly rng: Rng;
}

/** Inicia a mão com cartas dadas (testes, replay). */
export function startHandFromCards(p: StartHandFromCards): HandState {
  const seats = p.seats ?? DEFAULT_SEATS;
  const scores = p.scores ?? [0, 0];
  const t = p.variant.specialHandThreshold;
  const at0 = scores[0] === t;
  const at1 = scores[1] === t;
  const ferro = at0 && at1 && (p.ironHand ?? true);
  const special: SpecialKind = ferro ? 'maoDeFerro' : at0 !== at1 ? 'maoDeOnze' : 'normal';
  const specialTeam: Team | null = special === 'maoDeOnze' ? (at0 ? 0 : 1) : null;
  const mao = nextSeat(p.pe, seats);
  return {
    variant: p.variant,
    seats,
    pe: p.pe,
    vira: p.variant.fixedManilhas === null ? p.vira : null,
    hands: p.hands.map((h) => [...h]),
    scores: [scores[0], scores[1]],
    special,
    specialTeam,
    specialAccepted: [],
    lastBetSeat: null,
    phase: special === 'maoDeOnze' ? 'specialDecision' : 'playing',
    tricks: [],
    current: [],
    currentStarter: mao,
    turn: mao,
    value: p.variant.baseHandValue,
    level: -1,
    lastRaiserTeam: null,
    pending: null,
    betsLocked: special === 'maoDeFerro',
    result: null,
  };
}

/** Embaralha, distribui 3 cartas por assento e vira a vira (se a variante usa). */
export function startHand(p: StartHandParams): HandState {
  const seats = p.seats ?? DEFAULT_SEATS;
  const { hands, vira } = deal(shuffle(createDeck(), p.rng), seats);
  return startHandFromCards({ ...p, seats, hands, vira });
}

function finish(state: HandState, result: HandOutcome): HandState {
  return { ...state, phase: 'finished', pending: null, result };
}

/** Decide a mão pelas vazas já jogadas; null se ainda indefinida. Ver "Empates em vaza". */
function decideByTricks(tricks: readonly Trick[]): HandOutcome | null {
  const r = tricks.map((t) => t.winnerTeam);
  const win = (team: Team): HandOutcome => ({
    winnerTeam: team,
    points: 0,
    reason: 'tricks',
  });
  const [r1, r2, r3] = r;
  if (r.length < 2 || r1 === undefined || r2 === undefined) return null;
  if (r.length === 2) {
    if (r1 !== null && r1 === r2) return win(r1);
    if (r1 === null && r2 !== null) return win(r2);
    if (r1 !== null && r2 === null) return win(r1);
    return null; // 1ª e 2ª de duplas diferentes, ou ambas empatadas: vai à 3ª
  }
  if (r3 !== undefined && r3 !== null) return win(r3);
  if (r1 !== null) return win(r1); // 3ª empatada: vale a 1ª (se houver)
  return { winnerTeam: null, points: 0, reason: 'draw' };
}

function resolveTrick(state: HandState, current: readonly PlayedCard[]): HandState {
  const strengths = current.map((p) =>
    p.covered ? COVERED_STRENGTH : cardStrength(state.variant, state.vira, p.card),
  );
  const max = Math.max(...strengths);
  const top = current.filter((_, i) => strengths[i] === max);
  const first = top[0];
  const tie = first === undefined || top.some((p) => teamOf(p.seat) !== teamOf(first.seat));
  const trick: Trick = {
    starter: state.currentStarter,
    plays: current,
    winnerSeat: tie || first === undefined ? null : first.seat,
    winnerTeam: tie || first === undefined ? null : teamOf(first.seat),
  };
  const tricks = [...state.tricks, trick];
  const decided = decideByTricks(tricks);
  if (decided !== null) {
    const points = decided.winnerTeam === null ? 0 : state.value;
    return finish({ ...state, tricks, current: [] }, { ...decided, points });
  }
  const turn = trick.winnerSeat ?? state.currentStarter;
  return { ...state, tricks, current: [], currentStarter: turn, turn };
}

function playAt(state: HandState, seat: Seat, index: number, covered: boolean): HandState {
  const hand = state.hands[seat] ?? [];
  const card = hand[index] as Card;
  const hands = state.hands.map((h, s) => (s === seat ? h.filter((_, i) => i !== index) : h));
  const current = [...state.current, { seat, card, covered }];
  const base = { ...state, hands };
  if (current.length === state.seats) return resolveTrick(base, current);
  return { ...base, current, turn: nextSeat(seat, state.seats) };
}

function phaseGuard(state: HandState, expected: 'playing'): Result<HandState> | null {
  if (state.phase === expected) return null;
  if (state.phase === 'specialDecision')
    return fail('SPECIAL_DECISION_PENDING', 'a dupla na frente precisa decidir jogar ou correr');
  return fail('BET_PENDING', 'há um pedido de aposta aguardando resposta');
}

/** Aplica uma ação à mão. Puro: nunca muta `state`; ação ilegal devolve RuleError. */
export function applyHandAction(state: HandState, action: HandAction): Result<HandState> {
  if (state.phase === 'finished') return fail('HAND_FINISHED', 'a mão já terminou');
  const { seat } = action;
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.seats)
    return fail('INVALID_SEAT', 'assento inexistente');
  const team = teamOf(seat);

  switch (action.type) {
    case 'playCard':
    case 'playBlindCard': {
      const guard = phaseGuard(state, 'playing');
      if (guard) return guard;
      if (seat !== state.turn) return fail('NOT_YOUR_TURN', 'não é a sua vez');
      const hand = state.hands[seat] ?? [];
      if (action.type === 'playBlindCard') {
        if (state.special !== 'maoDeFerro')
          return fail('NOT_BLIND_HAND', 'jogo às cegas só na mão de ferro');
        if (!Number.isInteger(action.index) || action.index < 0 || action.index >= hand.length)
          return fail('CARD_NOT_IN_HAND', 'posição inválida na mão');
        return ok(playAt(state, seat, action.index, false));
      }
      if (state.special === 'maoDeFerro')
        return fail('BLIND_ONLY', 'na mão de ferro as cartas são jogadas às cegas');
      const covered = action.covered === true;
      if (covered && state.tricks.length === 0)
        return fail('COVERED_NOT_ALLOWED', 'carta coberta só a partir da 2ª vaza');
      const index = hand.findIndex((c) => cardEquals(c, action.card));
      if (index < 0) return fail('CARD_NOT_IN_HAND', 'carta não está na mão');
      return ok(playAt(state, seat, index, covered));
    }
    case 'callBet': {
      const guard = phaseGuard(state, 'playing');
      if (guard) return guard;
      if (seat !== state.turn) return fail('NOT_YOUR_TURN', 'só se pede aposta no seu turno');
      if (
        state.betsLocked ||
        state.lastRaiserTeam === team ||
        state.level + 1 >= state.variant.betLadder.length
      )
        return fail('BET_NOT_ALLOWED', 'sua dupla não pode pedir aposta agora');
      return ok({
        ...state,
        phase: 'betPending',
        lastRaiserTeam: team,
        pending: {
          fromSeat: seat,
          fromTeam: team,
          toLevel: state.level + 1,
          // truco: o adversário que joga depois de quem pediu; aumentos: quem fez o pedido anterior
          responderSeat: state.lastBetSeat ?? nextSeat(seat, state.seats),
        },
      });
    }
    case 'acceptBet':
    case 'raiseBet':
    case 'runBet': {
      const pending = state.pending;
      if (state.phase !== 'betPending' || pending === null)
        return fail('NO_PENDING_BET', 'não há aposta pendente');
      if (seat !== pending.responderSeat)
        return fail('NOT_YOUR_TURN', 'quem responde é outro jogador');
      if (action.type === 'runBet')
        return ok(
          finish(state, { winnerTeam: pending.fromTeam, points: state.value, reason: 'betRun' }),
        );
      if (action.type === 'acceptBet')
        return ok({
          ...state,
          phase: 'playing',
          pending: null,
          lastBetSeat: pending.fromSeat,
          level: pending.toLevel,
          value: state.variant.betLadder[pending.toLevel] ?? state.value,
        });
      if (pending.toLevel + 1 >= state.variant.betLadder.length)
        return fail('BET_NOT_ALLOWED', 'não há aposta maior na escada');
      return ok({
        ...state,
        lastRaiserTeam: team,
        lastBetSeat: pending.fromSeat,
        // aumentar equivale a aceitar o pedido anterior: ele vira o valor vigente
        level: pending.toLevel,
        value: state.variant.betLadder[pending.toLevel] ?? state.value,
        pending: {
          fromSeat: seat,
          fromTeam: team,
          toLevel: pending.toLevel + 1,
          responderSeat: pending.fromSeat,
        },
      });
    }
    case 'playSpecial':
    case 'runSpecial': {
      if (state.phase !== 'specialDecision' || state.specialTeam === null)
        return fail('NO_SPECIAL_DECISION', 'não há decisão de mão de onze pendente');
      if (team !== state.specialTeam)
        return fail('NOT_YOUR_TURN', 'quem decide é a dupla na frente');
      if (state.specialAccepted.includes(seat))
        return fail('NOT_YOUR_TURN', 'você já aceitou jogar; aguarde o parceiro');
      if (action.type === 'runSpecial')
        return ok(
          finish(state, {
            winnerTeam: otherTeam(team),
            points: state.variant.baseHandValue,
            reason: 'specialRun',
          }),
        );
      const specialAccepted = [...state.specialAccepted, seat];
      if (specialAccepted.length < state.seats / 2) return ok({ ...state, specialAccepted });
      return ok({
        ...state,
        specialAccepted,
        phase: 'playing',
        betsLocked: true,
        level: 0,
        value: state.variant.betLadder[0] ?? state.value,
      });
    }
  }
}
