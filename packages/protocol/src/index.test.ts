import { describe, expect, it } from 'vitest';
import { SIGNAL_IDS, VARIANT_IDS } from './index';

describe('protocol', () => {
  it('catálogo tem 12 sinais com ids únicos', () => {
    expect(SIGNAL_IDS).toHaveLength(12);
    expect(new Set(SIGNAL_IDS).size).toBe(SIGNAL_IDS.length);
  });

  it('variantes suportadas são paulista e mineiro', () => {
    expect(VARIANT_IDS).toEqual(['paulista', 'mineiro']);
  });
});
