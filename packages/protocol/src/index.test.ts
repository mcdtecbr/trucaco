import { describe, expect, it } from 'vitest';
import {
  ACTION_MIN_INTERVAL_MS,
  CHAT_COOLDOWN_MS,
  CHAT_MAX_COMBINING_RUN,
  CHAT_MAX_LENGTH,
  MAX_MESSAGE_BYTES,
  CODES_COOLDOWN_MS,
  PARTNER_CODE_MAX_LENGTH,
  SIGNAL_COOLDOWN_MS,
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
  it('catálogo tem 15 sinais com ids únicos', () => {
    expect(SIGNAL_IDS).toHaveLength(15);
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

describe('limites de ação', () => {
  it('constantes coerentes', () => {
    expect(MAX_MESSAGE_BYTES).toBe(1024);
    expect(MAX_MESSAGE_BYTES).toBeGreaterThan(CHAT_MAX_LENGTH * 4);
    expect(ACTION_MIN_INTERVAL_MS).toBeGreaterThan(0);
    expect(ACTION_MIN_INTERVAL_MS).toBeLessThan(SIGNAL_COOLDOWN_MS);
    expect(CHAT_COOLDOWN_MS).toBeLessThan(SIGNAL_COOLDOWN_MS);
    expect(PARTNER_CODE_MAX_LENGTH).toBe(60);
    expect(CODES_COOLDOWN_MS).toBeLessThan(SIGNAL_COOLDOWN_MS);
    expect(CHAT_MAX_COMBINING_RUN).toBeGreaterThan(0);
  });
});
