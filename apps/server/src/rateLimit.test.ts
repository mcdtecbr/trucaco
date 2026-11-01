import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from './rateLimit';

describe('SlidingWindowLimiter: record e count', () => {
  it('record conta sem checar limite; count não registra nem reordena', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    for (let i = 0; i < 5; i++) l.record('k', 100 + i);
    expect(l.count('k', 200)).toBe(5);
    expect(l.count('k', 200)).toBe(5);
    expect(l.count('outra', 200)).toBe(0);
    expect(l.count('k', 1101)).toBe(3); // 100 e 101 saíram da janela
  });

  it('janela deslizante e teto de chaves valem para record', () => {
    const l = new SlidingWindowLimiter(1, 1000, 3);
    for (let i = 0; i < 10; i++) l.record(`k${i}`, 1);
    expect(l.size).toBe(3);
    l.record('x', 5000);
    expect(l.count('x', 5500)).toBe(1);
    expect(l.count('x', 6001)).toBe(0);
  });
});
