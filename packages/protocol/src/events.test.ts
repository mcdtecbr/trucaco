import { describe, expect, it } from 'vitest';
import { BET_CRY_BY_VALUE, BET_CRY_IDS, betCry } from './index';

describe('betCry', () => {
  it('escada Paulista (3, 6, 9, 12)', () => {
    expect([3, 6, 9, 12].map(betCry)).toEqual(['truco', 'seis', 'nove', 'doze']);
  });
  it('escada Mineira (4, 6, 8, 10, 12)', () => {
    expect([4, 6, 8, 10, 12].map(betCry)).toEqual(['truco', 'seis', 'oito', 'dez', 'doze']);
  });
  it('valor desconhecido ou chave herdada dá undefined', () => {
    for (const v of [0, 1, 2, 5, 7, 11, 13, -3, NaN]) expect(betCry(v)).toBeUndefined();
    expect(betCry(Number('constructor'))).toBeUndefined();
  });
  it('todos os gritos do mapa estão no catálogo e o mapa é imutável', () => {
    for (const id of Object.values(BET_CRY_BY_VALUE)) expect(BET_CRY_IDS).toContain(id);
    expect(Object.isFrozen(BET_CRY_BY_VALUE)).toBe(true);
  });
});
