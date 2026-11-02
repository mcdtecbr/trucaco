import { describe, expect, it } from 'vitest';
import { checkNickname } from './nickname';

describe('apelido (UX)', () => {
  it('aceita 3 a 16 letras latinas, dígitos, _ . -', () => {
    expect(checkNickname('Zé_da.Silva-9')).toEqual({ ok: true, nickname: 'Zé_da.Silva-9' });
    expect(checkNickname('  abc  ')).toEqual({ ok: true, nickname: 'abc' });
  });
  it('normaliza para NFC', () => {
    const r = checkNickname('José');
    expect(r).toEqual({ ok: true, nickname: 'José' });
  });
  it('recusa curto, longo, espaço, símbolo e outros alfabetos', () => {
    for (const bad of ['ab', 'a'.repeat(17), 'dois nomes', '<b>x</b>', 'Привет', 'a​b', '']) {
      expect(checkNickname(bad).ok).toBe(false);
    }
  });
});
