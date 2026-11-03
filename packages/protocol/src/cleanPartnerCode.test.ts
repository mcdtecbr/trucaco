import { describe, expect, it } from 'vitest';
import { PARTNER_CODE_MAX_LENGTH, cleanPartnerCode } from './index';

describe('cleanPartnerCode', () => {
  it('vazio vira string vazia; texto limpo é aparado', () => {
    expect(cleanPartnerCode('   ')).toBe('');
    expect(cleanPartnerCode('')).toBe('');
    expect(cleanPartnerCode('  tenho zap ')).toBe('tenho zap');
    expect(cleanPartnerCode('a\nb')).toBe('a b');
  });

  it('recusa bidi, ZWJ, controle e acima do teto', () => {
    expect(cleanPartnerCode(String.fromCharCode(97, 0x202e, 98))).toBeNull();
    expect(cleanPartnerCode(String.fromCharCode(97, 0x200d, 98))).toBeNull();
    expect(cleanPartnerCode('a\u0007b')).toBeNull();
    expect(cleanPartnerCode('x'.repeat(PARTNER_CODE_MAX_LENGTH + 1))).toBeNull();
    expect(cleanPartnerCode('x'.repeat(PARTNER_CODE_MAX_LENGTH))).not.toBeNull();
  });
});
