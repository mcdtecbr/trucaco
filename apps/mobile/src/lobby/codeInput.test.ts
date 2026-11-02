import { ROOM_CODE_ALPHABET } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { codeForNetwork, formatCodeDisplay, normalizeCodeInput } from './codeInput';

describe('código de mesa digitado', () => {
  it('normaliza: maiúsculas, sem espaço/hífen, no máximo 8', () => {
    expect(normalizeCodeInput(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeCodeInput('abcdefghjk')).toBe('ABCDEFGH');
    expect(normalizeCodeInput('a b\tc')).toBe('ABC');
  });

  it('máscara de exibição ABCD-EFGH', () => {
    expect(formatCodeDisplay('abc')).toBe('ABC');
    expect(formatCodeDisplay('abcd')).toBe('ABCD');
    expect(formatCodeDisplay('abcde')).toBe('ABCD-E');
    expect(formatCodeDisplay('abcdefgh')).toBe('ABCD-EFGH');
  });

  it('só devolve código para a rede quando isValidRoomCode aceita', () => {
    const ok = ROOM_CODE_ALPHABET.slice(0, 8);
    expect(codeForNetwork(ok.toLowerCase())).toBe(ok);
    expect(codeForNetwork(`${ok.slice(0, 4)}-${ok.slice(4)}`)).toBe(ok);
    expect(codeForNetwork('ABC')).toBeNull(); // curto
    expect(codeForNetwork('ABCDEFG0')).toBeNull(); // 0 fora do alfabeto
    expect(codeForNetwork('ABCDEFGO')).toBeNull(); // O fora do alfabeto
    expect(codeForNetwork('')).toBeNull();
    expect(codeForNetwork('<script>')).toBeNull();
  });
});
