import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { buildHealth } from './index';

describe('server', () => {
  it('health informa status ok, a versão do protocolo e nenhum login social por padrão', () => {
    expect(buildHealth()).toEqual({
      status: 'ok',
      protocol: PROTOCOL_VERSION,
      socialProviders: [],
    });
  });

  it('health lista os provedores sociais ligados (cópia, sem expor a lista interna)', () => {
    const on = ['google'] as const;
    const h = buildHealth(on);
    expect(h.socialProviders).toEqual(['google']);
    expect(h.socialProviders).not.toBe(on);
  });
});
