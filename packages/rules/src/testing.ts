import type { Card, Rank } from './cards';
import { SUITS } from './cards';
import { applyHandAction, startHandFromCards } from './hand';
import type { HandAction, HandState } from './hand';
import type { Variant } from './variant';
import type { Seat } from './types';

/** Apenas para testes: aplica ação e falha o teste se for ilegal. */
export function must(state: HandState, action: HandAction): HandState {
  const r = applyHandAction(state, action);
  if (!r.ok) throw new Error(`ação ilegal ${action.type}: ${r.error.code}`);
  return r.state;
}

/** Mão em que `tricks[vaza][assento]` é o valor da carta jogada pelo assento naquela vaza. */
export function handFromTricks(
  variant: Variant,
  tricks: readonly (readonly Rank[])[],
  opts: { vira?: Card; pe?: Seat; scores?: readonly [number, number] } = {},
): HandState {
  const seats = tricks[0]?.length ?? 4;
  const seen = new Set<string>();
  const hands = Array.from({ length: seats }, (_, s) =>
    tricks.map((t): Card => {
      const rank = t[s] as Rank;
      const suit = SUITS.find((x) => !seen.has(`${rank}${x}`));
      if (suit === undefined) throw new Error(`rank ${rank} usado mais de 4 vezes`);
      seen.add(`${rank}${suit}`);
      return { rank, suit };
    }),
  );
  return startHandFromCards({
    variant,
    seats,
    pe: opts.pe ?? seats - 1,
    scores: opts.scores,
    hands,
    vira: opts.vira ?? { rank: '4', suit: 'ouros' },
  });
}

/** Cada assento joga a primeira carta que tem, na ordem do turno, até `count` cartas. */
export function playFirstCards(state: HandState, count: number): HandState {
  let s = state;
  for (let i = 0; i < count; i++) {
    const card = s.hands[s.turn]?.[0] as Card;
    s = must(s, { type: 'playCard', seat: s.turn, card });
  }
  return s;
}

export function firstCard(state: HandState, seat: Seat): Card {
  return state.hands[seat]?.[0] as Card;
}
