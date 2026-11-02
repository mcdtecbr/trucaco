import { describe, expect, it } from 'vitest';
import { MIN_TOUCH, colors, contrastRatio } from './theme';

describe('tokens de tema', () => {
  it('pares de texto e fundo cumprem contraste AA (4.5:1)', () => {
    const pairs: Array<[string, string]> = [
      [colors.text, colors.background],
      [colors.text, colors.surface],
      [colors.text, colors.surfaceAlt],
      [colors.textMuted, colors.background],
      [colors.textMuted, colors.surface],
      [colors.onPrimary, colors.primary],
      [colors.danger, colors.background],
      [colors.danger, colors.surface],
      [colors.primary, colors.surface],
    ];
    for (const [fg, bg] of pairs) expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('contrastRatio: preto/branco = 21', () => {
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
  });

  it('alvo de toque mínimo é 44', () => {
    expect(MIN_TOUCH).toBe(44);
  });
});
