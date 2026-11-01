import { RANKS, SUITS } from './cards';
import type { Card } from './cards';
import type { Rng } from './rng';

/** Baralho de 40 cartas (sem 8, 9, 10 e coringa). */
export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank): Card => ({ rank, suit })));
}

/** Fisher-Yates; devolve novo array, não muta o recebido. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}

export const CARDS_PER_HAND = 3;

export interface Deal {
  /** hands[seat] = 3 cartas do assento. */
  readonly hands: readonly (readonly Card[])[];
  /** Próxima carta do baralho, usada como vira (o motor só a considera se a variante usa vira). */
  readonly vira: Card;
}

export function deal(deck: readonly Card[], seats: number): Deal {
  const hands = Array.from({ length: seats }, (_, s) =>
    deck.slice(s * CARDS_PER_HAND, (s + 1) * CARDS_PER_HAND),
  );
  const vira = deck[seats * CARDS_PER_HAND];
  if (vira === undefined) throw new Error('baralho insuficiente para a quantidade de assentos');
  return { hands, vira };
}

export function cardEquals(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}
