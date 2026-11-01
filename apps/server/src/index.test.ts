import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { buildHealth } from './index';

describe('server', () => {
  it('health informa status ok e a versão do protocolo', () => {
    expect(buildHealth()).toEqual({ status: 'ok', protocol: PROTOCOL_VERSION });
  });
});
