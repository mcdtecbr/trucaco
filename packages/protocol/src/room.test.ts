import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  validateRoomOptions,
} from './index';

const base = { variant: 'paulista', format: 'single', ironHand: false, visibility: 'public' };

describe('código de mesa', () => {
  it('alfabeto sem ambíguos e sem repetição', () => {
    expect(ROOM_CODE_LENGTH).toBe(6);
    for (const c of '01OIL') expect(ROOM_CODE_ALPHABET).not.toContain(c);
    expect(new Set(ROOM_CODE_ALPHABET).size).toBe(ROOM_CODE_ALPHABET.length);
    expect(ROOM_CODE_ALPHABET).toHaveLength(31);
  });
  it('valida formato', () => {
    expect(isValidRoomCode('ABC234')).toBe(true);
    for (const bad of [
      'ABC23',
      'ABC2345',
      'abc234',
      'ABC0O1',
      'ABCIL2',
      '',
      null,
      123,
      undefined,
    ]) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
  });
});

describe('validateRoomOptions', () => {
  it('aceita single pública e bo3 privada', () => {
    expect(validateRoomOptions(base)).toEqual({ ok: true, options: base });
    const bo3 = { ...base, format: 'bo3', visibility: 'private', variant: 'mineiro' };
    expect(validateRoomOptions(bo3)).toEqual({ ok: true, options: bo3 });
  });
  it('rejeita bo3 pública', () => {
    expect(validateRoomOptions({ ...base, format: 'bo3' })).toEqual({
      ok: false,
      error: 'BO3_REQUIRES_PRIVATE',
    });
  });
  it('rejeita lixo', () => {
    for (const bad of [
      null,
      [],
      'x',
      1,
      {},
      { ...base, variant: 'x' },
      { ...base, ironHand: 'no' },
      { ...base, extra: 1 },
    ]) {
      expect(validateRoomOptions(bad)).toEqual({ ok: false, error: 'INVALID_OPTIONS' });
    }
  });
});
