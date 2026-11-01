import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  QUICK_PHRASES,
  QUICK_PHRASE_IDS,
  RECONNECT_SECONDS,
  SFX_COOLDOWN_MS,
  SFX_IDS,
  SIGNAL_IDS,
  TURN_TIMEOUT_MS,
  VARIANT_IDS,
} from './index';

describe('protocol', () => {
  it('catálogo tem 12 sinais com ids únicos', () => {
    expect(SIGNAL_IDS).toHaveLength(12);
    expect(new Set(SIGNAL_IDS).size).toBe(SIGNAL_IDS.length);
  });

  it('variantes suportadas são paulista e mineiro', () => {
    expect(VARIANT_IDS).toEqual(['paulista', 'mineiro']);
  });

  it('constantes', () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(TURN_TIMEOUT_MS).toBe(20000);
    expect(RECONNECT_SECONDS).toBe(60);
    expect(SFX_COOLDOWN_MS).toBe(5000);
  });

  it('sfx e frases rápidas: ids únicos e batendo com docs/audio.md', () => {
    expect(SFX_IDS).toHaveLength(8);
    expect(new Set(SFX_IDS).size).toBe(SFX_IDS.length);
    expect(new Set(QUICK_PHRASE_IDS).size).toBe(QUICK_PHRASES.length);
    for (const p of QUICK_PHRASES) expect(p.label.length).toBeGreaterThan(0);
  });

  it('catálogos são literais readonly (as const) sem duplicatas', () => {
    for (const list of [SIGNAL_IDS, SFX_IDS, VARIANT_IDS]) {
      expect(new Set(list).size).toBe(list.length);
    }
  });
});
