import { applyHandAction, startHand } from './hand';
import type { HandAction, HandState } from './hand';
import { failAction, handEvents, scoresAfterHand } from './events';
import type { ActionResult, GameEvent, Transition } from './events';
import type { Rng } from './rng';
import { DEFAULT_SEATS, nextSeat } from './types';
import type { Seat, Team } from './types';
import { GAME_POINTS } from './variant';
import type { Variant } from './variant';

/** Um jogo de 12 pontos: placar por dupla, pé que gira a cada mão e a mão em curso. */
export interface MatchState {
  readonly variant: Variant;
  readonly seats: number;
  /** Mão de ferro habilitada (opção da sala). */
  readonly ironHand: boolean;
  /** Placar atual por dupla (já com as mãos encerradas). */
  readonly scores: readonly [number, number];
  /** Pé da mão em curso (ou da última mão, se o jogo acabou). */
  readonly pe: Seat;
  /** Número da mão em curso, a partir de 1. */
  readonly handNumber: number;
  readonly hand: HandState;
  /** Dupla vencedora; null enquanto o jogo corre. */
  readonly winner: Team | null;
}

export interface StartMatchParams {
  readonly variant: Variant;
  readonly seats?: number;
  /** Pé da primeira mão (padrão 0). */
  readonly pe?: Seat;
  /** Mão de ferro quando as duas duplas estão no limiar (padrão true). */
  readonly ironHand?: boolean;
  readonly rng: Rng;
}

function handStartedEvent(m: MatchState): GameEvent {
  return {
    type: 'handStarted',
    handNumber: m.handNumber,
    pe: m.pe,
    scores: m.scores,
    special: m.hand.special,
  };
}

export function startMatch(p: StartMatchParams): Transition<MatchState> {
  const seats = p.seats ?? DEFAULT_SEATS;
  const pe = p.pe ?? 0;
  const ironHand = p.ironHand ?? true;
  const hand = startHand({ variant: p.variant, seats, pe, scores: [0, 0], ironHand, rng: p.rng });
  const state: MatchState = {
    variant: p.variant,
    seats,
    ironHand,
    scores: [0, 0],
    pe,
    handNumber: 1,
    hand,
    winner: null,
  };
  return { state, events: [handStartedEvent(state)] };
}

/**
 * Delega à mão; ao terminar soma os pontos (limitado a 12), decide o jogo ou abre a próxima mão
 * com o pé seguinte. O `rng` só é usado para embaralhar a próxima mão.
 */
export function applyMatchAction(
  state: MatchState,
  action: HandAction,
  rng: Rng,
): ActionResult<MatchState> {
  if (state.winner !== null) return failAction('GAME_FINISHED', 'o jogo já terminou');
  const r = applyHandAction(state.hand, action);
  if (!r.ok) return { ok: false, error: r.error };
  const events = handEvents(state.hand, action, r.state);
  if (r.state.phase !== 'finished') return { ok: true, state: { ...state, hand: r.state }, events };
  const scores = scoresAfterHand(r.state);
  const winner: Team | null = scores[0] >= GAME_POINTS ? 0 : scores[1] >= GAME_POINTS ? 1 : null;
  if (winner !== null) {
    events.push({ type: 'gameDecided', winnerTeam: winner, scores });
    return { ok: true, state: { ...state, scores, hand: r.state, winner }, events };
  }
  const pe = nextSeat(state.pe, state.seats);
  const hand = startHand({
    variant: state.variant,
    seats: state.seats,
    pe,
    scores,
    ironHand: state.ironHand,
    rng,
  });
  const next: MatchState = { ...state, scores, pe, handNumber: state.handNumber + 1, hand };
  events.push(handStartedEvent(next));
  return { ok: true, state: next, events };
}
