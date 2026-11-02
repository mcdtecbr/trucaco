import type { Rank, Suit } from '@trucaco/protocol';
import { RANKS, SUITS } from '@trucaco/protocol';

export const SUIT_SYMBOL: Readonly<Record<Suit, string>> = {
  paus: '♣',
  copas: '♥',
  espadas: '♠',
  ouros: '♦',
};

const RANK_NAME: Readonly<Record<Rank, string>> = {
  '4': 'quatro',
  '5': 'cinco',
  '6': 'seis',
  '7': 'sete',
  Q: 'dama',
  J: 'valete',
  K: 'rei',
  A: 'ás',
  '2': 'dois',
  '3': 'três',
};

export function asRank(x: unknown): Rank | null {
  return RANKS.find((r) => r === x) ?? null;
}

export function asSuit(x: unknown): Suit | null {
  return SUITS.find((s) => s === x) ?? null;
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'copas' || suit === 'ouros';
}

/** "três de paus". Texto puro para leitor de tela. */
export function cardName(rank: Rank, suit: Suit): string {
  return `${RANK_NAME[rank]} de ${suit}`;
}

/** Identidade de carta vinda do servidor (`''` = sem carta). Valor desconhecido vira `null`. */
export function parseFace(card: {
  readonly rank: string;
  readonly suit: string;
}): { rank: Rank; suit: Suit } | null {
  const rank = asRank(card.rank);
  const suit = asSuit(card.suit);
  return rank === null || suit === null ? null : { rank, suit };
}
