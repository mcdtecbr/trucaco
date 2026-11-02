import { describe, expect, it } from 'vitest';
import {
  MIN_TOUCH,
  WIDE_BREAKPOINT,
  cardColors,
  cardSizes,
  colors,
  contrastRatio,
  spacing,
  teamColors,
} from './tokens';

const AA = 4.5;

describe('tokens de tema', () => {
  it('pares de texto e fundo cumprem contraste AA (4.5:1)', () => {
    const pairs: Array<[string, string]> = [
      [colors.text, colors.background],
      [colors.text, colors.surface],
      [colors.text, colors.surfaceAlt],
      [colors.textMuted, colors.background],
      [colors.textMuted, colors.surface],
      [colors.textMuted, colors.surfaceAlt],
      [colors.onPrimary, colors.primary],
      [colors.onDanger, colors.danger],
      [colors.danger, colors.background],
      [colors.danger, colors.surface],
      [colors.success, colors.surface],
      [colors.primary, colors.surface],
      [cardColors.red, cardColors.face],
      [cardColors.black, cardColors.face],
      [teamColors.a.on, teamColors.a.main],
      [teamColors.b.on, teamColors.b.main],
      [teamColors.a.main, colors.surface],
      [teamColors.b.main, colors.surface],
      [cardColors.backBorder, cardColors.back],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrastRatio(fg, bg), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(AA);
    }
  });

  it('contrastRatio: preto/branco = 21 e é simétrico', () => {
    expect(Math.round(contrastRatio('#000000', '#FFFFFF'))).toBe(21);
    expect(contrastRatio('#123456', '#FEDCBA')).toBeCloseTo(contrastRatio('#FEDCBA', '#123456'));
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });

  it('alvo de toque mínimo é 44 e a carta menor já o alcança em largura', () => {
    expect(MIN_TOUCH).toBe(44);
    expect(cardSizes.sm.width).toBeGreaterThanOrEqual(MIN_TOUCH);
  });

  it('espaçamento segue a grade 4/8 e o breakpoint largo é 900', () => {
    for (const v of Object.values(spacing)) expect(v % 4).toBe(0);
    expect(WIDE_BREAKPOINT).toBe(900);
  });
});
