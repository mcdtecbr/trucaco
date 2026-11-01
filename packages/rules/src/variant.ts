import type { Card, Rank, VariantId } from './cards';

/** Diferenças entre Paulista e Mineiro (docs/regras-truco.md, "Parametrização no motor"). */
export interface Variant {
  readonly id: VariantId;
  /** Valor base da mão: 1 | 2. */
  readonly baseHandValue: number;
  /** Escada de apostas: [3,6,9,12] | [4,6,8,10,12]. */
  readonly betLadder: readonly number[];
  /** null: manilha definida pela vira. Senão, manilhas fixas da mais forte para a mais fraca. */
  readonly fixedManilhas: readonly Card[] | null;
  /** Pontos que ativam mão de onze/dez: 11 | 10. */
  readonly specialHandThreshold: number;
  /** Hierarquia das cartas comuns, da mais forte para a mais fraca. */
  readonly commonRank: readonly Rank[];
}

/** Pontos para vencer o jogo. */
export const GAME_POINTS = 12;

const COMMON_RANK: readonly Rank[] = ['3', '2', 'A', 'K', 'J', 'Q', '7', '6', '5', '4'];

export const PAULISTA: Variant = {
  id: 'paulista',
  baseHandValue: 1,
  betLadder: [3, 6, 9, 12],
  fixedManilhas: null,
  specialHandThreshold: 11,
  commonRank: COMMON_RANK,
};

export const MINEIRO: Variant = {
  id: 'mineiro',
  baseHandValue: 2,
  betLadder: [4, 6, 8, 10, 12],
  fixedManilhas: [
    { rank: '4', suit: 'paus' },
    { rank: '7', suit: 'copas' },
    { rank: 'A', suit: 'espadas' },
    { rank: '7', suit: 'ouros' },
  ],
  specialHandThreshold: 10,
  commonRank: COMMON_RANK,
};

export function variantById(id: VariantId): Variant {
  return id === 'paulista' ? PAULISTA : MINEIRO;
}
