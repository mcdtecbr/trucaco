/** Valores de carta do baralho de truco (40 cartas), do mais fraco ao mais forte na ordem natural. */
export const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const;

export type Rank = (typeof RANKS)[number];

/** Naipes: paus ♣, copas ♥, espadas ♠, ouros ♦. */
export const SUITS = ['paus', 'copas', 'espadas', 'ouros'] as const;

export type Suit = (typeof SUITS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}
