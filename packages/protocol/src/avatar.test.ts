import { describe, expect, it } from 'vitest';
import {
  AVATAR_PART_COUNTS,
  AVATAR_PART_KEYS,
  DEFAULT_AVATAR_PARTS,
  VOICE_IDS,
  parseAvatarParts,
} from './avatar';

const valid = { ...DEFAULT_AVATAR_PARTS };

describe('catálogo de partes do avatar', () => {
  it('contagens combinadas', () => {
    expect(AVATAR_PART_KEYS.map((k) => AVATAR_PART_COUNTS[k])).toEqual([
      6, 8, 8, 6, 5, 6, 3, 8, 8, 3, 11, 4, 8,
    ]);
    expect(AVATAR_PART_KEYS.slice(-5)).toEqual([
      'hair_color',
      'eye_color',
      'outfit_color',
      'brows',
      'nose',
    ]);
  });

  it('cores novas começam em 0 por padrão', () => {
    expect(DEFAULT_AVATAR_PARTS).toMatchObject({
      hair_color: 0,
      eye_color: 0,
      outfit_color: 0,
      brows: 0,
      nose: 0,
    });
  });

  it('o padrão é válido', () => {
    expect(parseAvatarParts(DEFAULT_AVATAR_PARTS)).toEqual(DEFAULT_AVATAR_PARTS);
  });
});

describe('parseAvatarParts', () => {
  it.each(['hair_color', 'eye_color', 'outfit_color', 'brows', 'nose'] as const)(
    'rejeita avatar sem %s e índice fora do intervalo',
    (key) => {
      const without = Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
      expect(parseAvatarParts(without)).toBeNull();
      expect(parseAvatarParts({ ...valid, [key]: AVATAR_PART_COUNTS[key] })).toBeNull();
      expect(parseAvatarParts({ ...valid, [key]: -1 })).toBeNull();
      expect(parseAvatarParts({ ...valid, [key]: AVATAR_PART_COUNTS[key] - 1 })).not.toBeNull();
    },
  );

  it('aceita o último índice de cada parte e voice do catálogo', () => {
    const max = Object.fromEntries(AVATAR_PART_KEYS.map((k) => [k, AVATAR_PART_COUNTS[k] - 1]));
    for (const voice of VOICE_IDS) {
      expect(parseAvatarParts({ ...max, voice })).toEqual({ ...max, voice });
    }
    expect(parseAvatarParts(max)).toEqual(max);
  });

  it('devolve cópia canônica (sem aliasing)', () => {
    const out = parseAvatarParts(valid);
    expect(out).not.toBe(valid);
  });

  it('rejeita chave extra, inclusive __proto__ vindo de JSON', () => {
    expect(parseAvatarParts({ ...valid, hat: 1 })).toBeNull();
    expect(parseAvatarParts(JSON.parse(`{"__proto__":{"a":1},"face_shape":0}`))).toBeNull();
    expect(
      parseAvatarParts(JSON.parse(JSON.stringify(valid).replace('{', '{"__proto__":{},'))),
    ).toBeNull();
  });

  it('rejeita parte faltando', () => {
    for (const key of AVATAR_PART_KEYS) {
      const { [key]: _omit, ...rest } = valid;
      void _omit;
      expect(parseAvatarParts(rest)).toBeNull();
    }
  });

  it('rejeita índice fora do intervalo, negativo, fracionário e não finito', () => {
    for (const key of AVATAR_PART_KEYS) {
      for (const bad of [AVATAR_PART_COUNTS[key], -1, 0.5, NaN, Infinity]) {
        expect(parseAvatarParts({ ...valid, [key]: bad })).toBeNull();
      }
    }
  });

  it('rejeita tipo errado', () => {
    for (const bad of ['1', true, null, undefined, [0], {}]) {
      expect(parseAvatarParts({ ...valid, skin: bad })).toBeNull();
    }
    for (const bad of [null, undefined, 'x', 1, [], [valid], new Date(), new Map()]) {
      expect(parseAvatarParts(bad)).toBeNull();
    }
  });

  it('rejeita voice inválida', () => {
    for (const voice of ['robo', 1, null, undefined, '']) {
      expect(parseAvatarParts({ ...valid, voice })).toBeNull();
    }
  });

  it('rejeita texto livre antigo', () => {
    expect(parseAvatarParts({ hat: 'cap', skin: 3, glasses: false })).toBeNull();
  });
});
