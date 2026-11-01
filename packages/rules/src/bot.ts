import type { HandAction, HandState } from './hand';
import { legalActions } from './legal';
import type { MatchState } from './match';
import type { Rng } from './rng';
import type { SeriesState } from './series';
import { cardStrength } from './strength';
import type { Seat } from './types';

function handOf(state: HandState | MatchState | SeriesState): HandState {
  if ('match' in state) return state.match.hand;
  if ('hand' in state) return state.hand;
  return state;
}

/**
 * Bot mínimo: corre de aposta pendente, joga a carta aberta mais fraca; em onze/dez joga; na mão de
 * ferro joga a primeira posição (ou sorteada, se houver `rng`). Nunca pede nem aumenta aposta.
 * Devolve null se o assento não tem ação.
 */
export function botAction(
  state: HandState | MatchState | SeriesState,
  seat: Seat,
  rng?: Rng,
): HandAction | null {
  const legal = legalActions(state, seat);
  if (legal.length === 0) return null;
  const run = legal.find((a) => a.type === 'runBet');
  if (run !== undefined) return run;
  const play = legal.find((a) => a.type === 'playSpecial');
  if (play !== undefined) return play;
  const hand = handOf(state);
  const blind = legal.filter((a) => a.type === 'playBlindCard');
  if (blind.length > 0)
    return blind[rng === undefined ? 0 : Math.floor(rng() * blind.length)] ?? null;
  let best: HandAction | null = null;
  let bestStrength = Infinity;
  for (const a of legal) {
    if (a.type !== 'playCard' || a.covered === true) continue;
    const s = cardStrength(hand.variant, hand.vira, a.card);
    if (s < bestStrength) {
      best = a;
      bestStrength = s;
    }
  }
  return best ?? legal[0] ?? null;
}
