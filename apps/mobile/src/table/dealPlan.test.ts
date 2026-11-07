import { describe, expect, it } from 'vitest';
import {
  CARDS_PER_SEAT,
  COLLECT_FLIP_MS,
  COLLECT_MS,
  COLLECT_PILE_MS,
  DEAL_FLIGHT_MS,
  DEAL_STEP_MS,
  DEAL_OVERLAP_MS,
  SHUFFLE_MS,
  SHUFFLE_OVERLAP_MS,
  dealDecision,
  dealPlan,
  dealSeatOrder,
  handHoldMs,
  PLAY_SLIDE_MS,
  playSlideMs,
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
    expect(starts[0]).toBe(SHUFFLE_MS - DEAL_OVERLAP_MS);
    expect(starts[1]! - starts[0]!).toBe(DEAL_STEP_MS);
  });

  it('recolher antecipa o embaralhar; a mão aparece antes do fim e a vira só no fim', () => {
    const a = dealPlan({ pe: 0, mySeat: 3, collect: false });
    const b = dealPlan({ pe: 0, mySeat: 3, collect: true });
    expect(b.collectMs).toBe(COLLECT_MS);
    expect(b.endMs - a.endMs).toBe(COLLECT_MS - SHUFFLE_OVERLAP_MS);
    // As fases se sobrepõem: o balanço começa antes do fim do recolher e a 1ª carta antes do fim do balanço.
    expect(b.shuffleStartMs).toBeLessThan(b.collectMs);
    expect(b.cards[0]!.startMs).toBeLessThan(b.shuffleStartMs + b.shuffleMs);
    // Assento 3 é o terceiro a receber em cada rodada: a última carta dele pousa antes da do pé.
    expect(b.selfLandedMs).toBeLessThan(b.endMs);
    expect(b.endMs).toBe(b.cards[11]!.startMs + DEAL_FLIGHT_MS);
  });

  it('tempos: recolher em duas partes, 2 a 3 cartas em voo, distribuição em cerca de 3 s', () => {
    expect(COLLECT_MS).toBe(COLLECT_FLIP_MS + COLLECT_PILE_MS);
    expect(DEAL_FLIGHT_MS / DEAL_STEP_MS).toBeGreaterThanOrEqual(1.5);
    expect(DEAL_FLIGHT_MS / DEAL_STEP_MS).toBeLessThanOrEqual(3);
    const p = dealPlan({ pe: 0, mySeat: 0, collect: false });
    expect(p.endMs - p.cards[0]!.startMs).toBeGreaterThanOrEqual(2500);
    expect(p.endMs - p.cards[0]!.startMs).toBeLessThanOrEqual(3500);
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

describe('playSlideMs', () => {
  it('E2E e reduzir movimento não passam deslize; antes de armar vale 0', () => {
    expect(playSlideMs(false, false, true)).toBeUndefined();
    expect(playSlideMs(true, true, true)).toBeUndefined();
    expect(playSlideMs(true, false, false)).toBe(0);
    expect(playSlideMs(true, false, true)).toBe(PLAY_SLIDE_MS);
  });
});

describe('handHoldMs', () => {
  it('sem animação (E2E, testes): nenhuma pausa', () => {
    expect(handHoldMs(false, false)).toBe(0);
    expect(handHoldMs(false, true)).toBe(0);
  });
  it('pausa legível (2,0 a 2,5 s) e menor com reduzir movimento', () => {
    expect(handHoldMs(true, false)).toBeGreaterThanOrEqual(2000);
    expect(handHoldMs(true, false)).toBeLessThanOrEqual(2500);
    expect(handHoldMs(true, true)).toBeLessThan(handHoldMs(true, false));
    expect(handHoldMs(true, true)).toBeGreaterThan(0);
  });
});

describe('collectPlan', () => {
  it('só recolhe: sem embaralhar nem distribuir', async () => {
    const { collectPlan, COLLECT_MS } = await import('./dealPlan');
    const p = collectPlan();
    expect(p.cards).toHaveLength(0);
    expect(p.shuffleMs).toBe(0);
    expect(p.collectMs).toBe(COLLECT_MS);
    expect(p.endMs).toBe(COLLECT_MS);
  });
});
