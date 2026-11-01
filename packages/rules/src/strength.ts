import { SUITS } from './cards';
import type { Card, Rank } from './cards';
import { cardEquals } from './deck';
import type { Variant } from './variant';

/** Carta coberta perde de qualquer carta aberta; duas cobertas empatam. */
export const COVERED_STRENGTH = 0;
const MANILHA_BASE = 100;

/** Valor da manilha dado a vira (Paulista): o imediatamente superior na hierarquia, circular. */
export function manilhaRank(variant: Variant, vira: Card | null): Rank | null {
  if (variant.fixedManilhas !== null || vira === null) return null;
  const order = variant.commonRank;
  const i = order.indexOf(vira.rank);
  return order[(i - 1 + order.length) % order.length] ?? null;
}

export function isManilha(variant: Variant, vira: Card | null, card: Card): boolean {
  if (variant.fixedManilhas !== null) return variant.fixedManilhas.some((m) => cardEquals(m, card));
  return manilhaRank(variant, vira) === card.rank;
}

/** Força de uma carta aberta. Maior vence; igual empata (só entre cartas comuns). */
export function cardStrength(variant: Variant, vira: Card | null, card: Card): number {
  if (variant.fixedManilhas !== null) {
    const idx = variant.fixedManilhas.findIndex((m) => cardEquals(m, card));
    if (idx >= 0) return MANILHA_BASE + (variant.fixedManilhas.length - idx);
  } else if (manilhaRank(variant, vira) === card.rank) {
    // paus (zap) > copas > espadas > ouros: ordem de SUITS
    return MANILHA_BASE + (SUITS.length - SUITS.indexOf(card.suit));
  }
  return variant.commonRank.length - variant.commonRank.indexOf(card.rank);
}

/** Resultado da comparação: >0 se a vence, <0 se b vence, 0 empate. */
export function compareCards(variant: Variant, vira: Card | null, a: Card, b: Card): number {
  return cardStrength(variant, vira, a) - cardStrength(variant, vira, b);
}
