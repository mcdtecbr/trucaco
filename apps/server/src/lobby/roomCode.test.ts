import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isValidRoomCode } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { generateUniqueRoomCode, randomRoomCode } from './roomCode';

describe('gerador de código de mesa', () => {
  it('8 caracteres do alfabeto, sempre válidos para isValidRoomCode', () => {
    for (let i = 0; i < 2000; i++) {
      const code = randomRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect([...code].every((c) => ROOM_CODE_ALPHABET.includes(c))).toBe(true);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('usa todo o alfabeto (sem símbolo morto) e nenhum caractere ambíguo', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3000; i++) for (const c of randomRoomCode()) seen.add(c);
    expect(seen.size).toBe(ROOM_CODE_ALPHABET.length);
    for (const bad of '01OIL') expect(seen.has(bad)).toBe(false);
  });

  it('colisão forçada: tenta de novo até achar um livre', () => {
    // RNG determinístico: as 3 primeiras tentativas repetem o mesmo código (índice 0), a 4ª muda.
    let call = 0;
    const rand = (): number => (call++ < ROOM_CODE_LENGTH * 3 ? 0 : 1);
    const taken = new Set([ROOM_CODE_ALPHABET.charAt(0).repeat(ROOM_CODE_LENGTH)]);
    const code = generateUniqueRoomCode((c) => taken.has(c), rand);
    expect(taken.has(code)).toBe(false);
    expect(code).toBe(ROOM_CODE_ALPHABET.charAt(1).repeat(ROOM_CODE_LENGTH));
  });

  it('esgotadas as tentativas, lança em vez de repetir um código em uso', () => {
    expect(() => generateUniqueRoomCode(() => true, undefined, 5)).toThrow();
  });

  it('sem colisão entre milhares de códigos registrados', () => {
    const used = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const c = generateUniqueRoomCode((x) => used.has(x));
      expect(used.has(c)).toBe(false);
      used.add(c);
    }
  });
});
