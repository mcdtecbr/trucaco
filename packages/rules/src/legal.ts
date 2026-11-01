import type { HandAction, HandState } from './hand';
import type { MatchState } from './match';
import type { SeriesState } from './series';
import { otherTeam, teamOf } from './types';
import type { Seat } from './types';

function legalHandActions(state: HandState, seat: Seat): HandAction[] {
  if (state.phase === 'finished' || !Number.isInteger(seat) || seat < 0 || seat >= state.seats)
    return [];
  const team = teamOf(seat);
  if (state.phase === 'specialDecision') {
    if (team !== state.specialTeam) return [];
    return [
      { type: 'playSpecial', seat },
      { type: 'runSpecial', seat },
    ];
  }
  if (state.phase === 'betPending') {
    const p = state.pending;
    if (p === null || team !== otherTeam(p.fromTeam)) return [];
    const out: HandAction[] = [
      { type: 'acceptBet', seat },
      { type: 'runBet', seat },
    ];
    if (p.toLevel + 1 < state.variant.betLadder.length) out.push({ type: 'raiseBet', seat });
    return out;
  }
  if (seat !== state.turn) return [];
  const hand = state.hands[seat] ?? [];
  const out: HandAction[] = [];
  if (state.special === 'maoDeFerro') {
    hand.forEach((_, index) => out.push({ type: 'playBlindCard', seat, index }));
  } else {
    for (const card of hand) {
      out.push({ type: 'playCard', seat, card });
      if (state.tricks.length > 0) out.push({ type: 'playCard', seat, card, covered: true });
    }
  }
  if (
    !state.betsLocked &&
    state.lastRaiserTeam !== team &&
    state.level + 1 < state.variant.betLadder.length
  )
    out.push({ type: 'callBet', seat });
  return out;
}

/** Ações que `apply*Action` aceita para o assento agora. Vazio fora do turno ou com jogo/série encerrados. */
export function legalActions(
  state: HandState | MatchState | SeriesState,
  seat: Seat,
): HandAction[] {
  if ('match' in state) {
    if (state.winner !== null || state.cancelled) return [];
    return legalHandActions(state.match.hand, seat);
  }
  if ('hand' in state) {
    if (state.winner !== null) return [];
    return legalHandActions(state.hand, seat);
  }
  return legalHandActions(state, seat);
}

/** Primeiro assento com ação legal (quem deve agir), ou null se nada a fazer. */
export function pendingSeat(state: HandState | MatchState | SeriesState): Seat | null {
  const seats = 'match' in state ? state.seats : state.seats;
  for (let s = 0; s < seats; s++) if (legalActions(state, s).length > 0) return s;
  return null;
}
