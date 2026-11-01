import { describe, expect, it } from 'vitest';
import { RULES_ENGINE_READY } from './index';

describe('rules', () => {
  it('pacote carrega e declara o motor de mão pronto', () => {
    expect(RULES_ENGINE_READY).toBe(true);
  });
});
