import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_SEAT,
  COLLECT_MS,
  DEAL_FLIGHT_MS,
  DEAL_STEP_MS,
  SHUFFLE_MS,
  dealDecision,
  dealPlan,
  dealSeatOrder,
} from './dealPlan';

describe('dealSeatOrder', () => {
  it('começa pelo mão (assento depois do pé) e segue a ordem da mesa', () => {
    expect(dealSeatOrder(0)).toEqual([1, 2, 3, 0]);
    expect(dealSeatOrder(2)).toEqual([3, 0, 1, 2]);
    expect(dealSeatOrder(3)).toEqual([0, 1, 2, 3]);
  });
});

describe('dealPlan', () => {
  it('distribui 12 cartas, uma por jogador por rodada, em ordem de saída', () => {
    const p = dealPlan({ pe: 1, mySeat: 0, collect: false });
    expect(p.cards).toHaveLength(4 * CARDS_PER_SEAT);
    expect(p.cards.slice(0, 5).map((c) => c.seat)).toEqual([2, 3, 0, 1, 2]);
    expect(p.cards.map((c) => c.round)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2]);
    const starts = p.cards.map((c) => c.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts[0]).toBe(SHUFFLE_MS);
    expect(starts[1]! - starts[0]!).toBe(DEAL_STEP_MS);
  });

  it('recolher antecipa o embaralhar; a mão aparece antes do fim e a vira só no fim', () => {
    const a = dealPlan({ pe: 0, mySeat: 3, collect: false });
    const b = dealPlan({ pe: 0, mySeat: 3, collect: true });
    expect(b.collectMs).toBe(COLLECT_MS);
    expect(b.endMs - a.endMs).toBe(COLLECT_MS);
    // Assento 3 é o terceiro a receber em cada rodada: a última carta dele pousa antes da do pé.
    expect(b.selfLandedMs).toBeLessThan(b.endMs);
    expect(b.endMs).toBe(b.cards[11]!.startMs + DEAL_FLIGHT_MS);
  });

  it('pé desconhecido não quebra', () => {
    expect(dealPlan({ pe: -1, mySeat: 0, collect: false }).cards[0]?.seat).toBe(0);
  });
});

describe('dealDecision', () => {
  it('desligada ou mesma mão: não anima', () => {
    expect(dealDecision(null, '1:1', false).animate).toBe(false);
    expect(dealDecision('1:1', '1:1', true).animate).toBe(false);
  });

  it('primeira leitura distribui sem recolher; troca de mão recolhe e distribui', () => {
    expect(dealDecision(null, '1:1', true)).toEqual({ animate: true, collect: false });
    expect(dealDecision(null, '1:1', true, false)).toEqual({ animate: false, collect: false });
    expect(dealDecision('1:1', '1:2', true)).toEqual({ animate: true, collect: true });
  });
});
