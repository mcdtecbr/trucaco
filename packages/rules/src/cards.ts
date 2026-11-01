/**
 * Tipos de carta. Mantidos em sincronia (estrutural) com `packages/protocol/src/cards.ts`:
 * a fronteira de lint proíbe `rules` de importar pacotes internos (design, seção 3).
 */
export const RANKS = ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3'] as const;
export type Rank = (typeof RANKS)[number];

export const SUITS = ['paus', 'copas', 'espadas', 'ouros'] as const;
export type Suit = (typeof SUITS)[number];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export type VariantId = 'paulista' | 'mineiro';
