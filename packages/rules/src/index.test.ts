import { describe, expect, it } from 'vitest';
import { RULES_ENGINE_READY } from './index';

describe('rules', () => {
  it('pacote carrega e ainda não declara o motor pronto', () => {
    expect(RULES_ENGINE_READY).toBe(false);
  });
});
