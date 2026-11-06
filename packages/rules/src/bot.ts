import type { HandAction, HandState } from './hand';
import { legalActions } from './legal';
import type { MatchState } from './match';
import type { Rng } from './rng';
import type { SeriesState } from './series';
import { cardStrength, isManilha } from './strength';
import { teamOf } from './types';
import type { Seat } from './types';
import type { Card } from './cards';

/**
 * Perfil do bot. `absence`: substitui humano caído, sempre corre de aposta. `vacancy`: ocupa vaga de
 * mesa privada, aceita ou corre de aposta pela força da própria mão. Nenhum perfil pede ou aumenta aposta.
 */
export type BotProfile = 'absence' | 'vacancy';

function handOf(state: HandState | MatchState | SeriesState): HandState {
  if ('match' in state) return state.match.hand;
  if ('hand' in state) return state.hand;
  return state;
}

/** Valor de uma carta em [0, ~1,4]: comum até 0,8; manilha de 1,1 (a mais fraca) a 1,4 (zap). */
function cardValue(hand: HandState, card: Card): number {
  const s = cardStrength(hand.variant, hand.vira, card);
  if (isManilha(hand.variant, hand.vira, card)) return 1 + (s - 100) / 10;
  return (s / hand.variant.commonRank.length) * 0.8;
}

/** Valores das cartas na mão do próprio assento, da mais forte para a mais fraca. */
function sortedValues(hand: HandState, seat: Seat): number[] {
  return (hand.hands[seat] ?? []).map((c) => cardValue(hand, c)).sort((a, b) => b - a);
}

const ACCEPT_THRESHOLD = 1.2;
const ACCEPT_THRESHOLD_AHEAD = 0.9;
const NOISE = 0.1;
/** Soma das três cartas abaixo da qual o bot de vaga corre da mão de onze/dez. */
const SPECIAL_RUN_THRESHOLD = 0.9;

/** Aceita a aposta? Só olha a mão do próprio assento e as vazas já jogadas (públicas). */
function vacancyAcceptsBet(hand: HandState, seat: Seat, rng?: Rng): boolean {
  // Mão de ferro: o bot não "vê" a carta (jogada às cegas), então não tem base para recusar.
  if (hand.special === 'maoDeFerro') return true;
  const values = sortedValues(hand, seat);
  const score = (values[0] ?? 0) + (values[1] ?? 0);
  const first = hand.tricks[0];
  const ahead = first !== undefined && first.winnerTeam === teamOf(seat);
  const noise = rng === undefined ? 0 : (rng() * 2 - 1) * NOISE;
  return score + noise >= (ahead ? ACCEPT_THRESHOLD_AHEAD : ACCEPT_THRESHOLD);
}

function vacancyAcceptsSpecial(hand: HandState, seat: Seat, rng?: Rng): boolean {
  const total = sortedValues(hand, seat).reduce((a, b) => a + b, 0);
  const noise = rng === undefined ? 0 : (rng() * 2 - 1) * NOISE;
  return total + noise >= SPECIAL_RUN_THRESHOLD;
}

/**
 * Bot: nunca pede nem aumenta aposta. Perfil `absence` (padrão): corre de aposta pendente, joga a carta
 * aberta mais fraca; em onze/dez joga; na mão de ferro joga a primeira posição (ou sorteada, se houver
 * `rng`). Perfil `vacancy`: igual na jogada de cartas, mas aceita ou corre da aposta pela força da mão
 * do próprio assento (com ruído pequeno se houver `rng`) e só corre da mão de onze/dez se a mão for
 * péssima. Devolve null se o assento não tem ação.
 */
export function botAction(
  state: HandState | MatchState | SeriesState,
  seat: Seat,
  rng?: Rng,
  profile: BotProfile = 'absence',
): HandAction | null {
  const legal = legalActions(state, seat);
  if (legal.length === 0) return null;
  const hand = handOf(state);
  if (profile === 'vacancy') {
    const accept = legal.find((a) => a.type === 'acceptBet');
    const runB = legal.find((a) => a.type === 'runBet');
    if (accept !== undefined && runB !== undefined)
      return vacancyAcceptsBet(hand, seat, rng) ? accept : runB;
    const playS = legal.find((a) => a.type === 'playSpecial');
    const runS = legal.find((a) => a.type === 'runSpecial');
    if (playS !== undefined && runS !== undefined)
      return vacancyAcceptsSpecial(hand, seat, rng) ? playS : runS;
  }
  const run = legal.find((a) => a.type === 'runBet');
  if (run !== undefined) return run;
  const play = legal.find((a) => a.type === 'playSpecial');
  if (play !== undefined) return play;
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
