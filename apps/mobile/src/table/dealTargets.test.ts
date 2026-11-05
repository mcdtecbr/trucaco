import { describe, expect, it } from 'vitest';
import { dealTargets, FELT_INSET } from './DealOverlay';

describe('dealTargets', () => {
  it('as cartas voam até o avatar de cada posição (bordas do pano) e eu embaixo', () => {
    const t = dealTargets(340, 380, 76);
    expect(t.partner.x).toBe(170);
    expect(t.partner.y).toBe(FELT_INSET + 41);
    expect(t.left).toEqual({ x: FELT_INSET + 41, y: 190 });
    expect(t.right).toEqual({ x: 340 - FELT_INSET - 41, y: 190 });
    expect(t.self.x).toBe(170);
    expect(t.self.y).toBeGreaterThan(300);
  });

  it('avatar maior afasta o alvo da borda', () => {
    expect(dealTargets(900, 500, 112).left.x).toBeGreaterThan(dealTargets(900, 500, 72).left.x);
  });
});
