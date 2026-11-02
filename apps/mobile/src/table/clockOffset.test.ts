import { describe, expect, it } from 'vitest';
import { OFFSET_MAX_ABS_MS, createClockOffset } from './clockOffset';

describe('clockOffset', () => {
  it('começa em 0 e segue a mediana das amostras (servidor - cliente)', () => {
    const c = createClockOffset();
    expect(c.get()).toBe(0);
    expect(c.add(10_500, 10_000)).toBe(500);
    expect(c.add(20_510, 20_000)).toBe(510); // mediana de [500, 510] (índice 1)
    expect(c.add(30_490, 30_000)).toBe(500);
    expect(c.get()).toBe(500);
  });

  it('suaviza picos: um replay antigo isolado não derruba a estimativa', () => {
    const c = createClockOffset();
    for (let i = 1; i <= 6; i++) c.add(i * 1000 + 200, i * 1000);
    expect(c.get()).toBe(200);
    c.add(5_000, 65_000); // evento de 60 s atrás
    expect(c.get()).toBe(200);
  });

  it('ignora entrada inválida e amostras absurdas', () => {
    const c = createClockOffset();
    c.add(1_000, 0);
    expect(c.add(Number.NaN, 5)).toBe(1_000);
    expect(c.add(0, 5)).toBe(1_000);
    expect(c.add(-3, 5)).toBe(1_000);
    expect(c.add(1_000 + OFFSET_MAX_ABS_MS + 1, 0)).toBe(1_000);
    expect(c.add(5, Number.POSITIVE_INFINITY)).toBe(1_000);
  });

  it('janela limitada: amostras velhas saem', () => {
    const c = createClockOffset(3);
    for (let i = 0; i < 3; i++) c.add(100, 0);
    for (let i = 0; i < 3; i++) c.add(900, 0);
    expect(c.get()).toBe(900);
  });

  it('funciona com relógio do cliente adiantado (offset negativo) e reset', () => {
    const c = createClockOffset();
    expect(c.add(10_000, 12_000)).toBe(-2_000);
    c.reset();
    expect(c.get()).toBe(0);
  });
});
