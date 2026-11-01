import { describe, expect, it } from 'vitest';
import {
  applyMatchAction,
  legalActions,
  MINEIRO,
  mulberry32,
  PAULISTA,
  startHand,
  startMatch,
  startSeries,
} from './index';
import type { Variant } from './index';
import { handFromTricks } from './testing';

describe.each([
  [PAULISTA, 11, 10, 1],
  [MINEIRO, 10, 8, 2],
] as const)('opção mão de ferro %s', (variant: Variant, limiar, abaixo, base) => {
  const hand = (ironHand?: boolean) =>
    startHand({ variant, pe: 0, scores: [limiar, limiar], ironHand, rng: mulberry32(1) });

  it('ligada (padrão e explícita): ambas no limiar é mão de ferro', () => {
    for (const h of [hand(), hand(true)]) {
      expect(h.special).toBe('maoDeFerro');
      expect(h.betsLocked).toBe(true);
      expect(legalActions(h, h.turn).some((a) => a.type === 'callBet')).toBe(false);
    }
  });

  it('desligada com as duas duplas no limiar: mão normal com apostas e cartas abertas', () => {
    const h = hand(false);
    expect(h.special).toBe('normal');
    expect(h.specialTeam).toBeNull();
    expect(h.phase).toBe('playing');
    expect(h.betsLocked).toBe(false);
    expect(h.value).toBe(variant.baseHandValue);
    const types = legalActions(h, h.turn).map((a) => a.type);
    expect(types).toContain('callBet');
    expect(types).toContain('playCard');
    expect(types).not.toContain('playBlindCard');
  });

  it('desligada não muda onze/dez com uma só dupla no limiar', () => {
    for (const ironHand of [true, false]) {
      const h = startHand({ variant, pe: 0, scores: [limiar, 3], ironHand, rng: mulberry32(1) });
      expect(h.special).toBe('maoDeOnze');
      expect(h.phase).toBe('specialDecision');
      expect(h.specialTeam).toBe(0);
    }
  });

  it('a opção atravessa a partida: próxima mão 11x11 respeita a opção', () => {
    const next = (ironHand: boolean) => {
      const m = startMatch({ variant, ironHand, rng: mulberry32(2) });
      expect(m.state.ironHand).toBe(ironHand);
      const s = {
        ...m.state,
        scores: [abaixo, limiar] as const,
        hand: handFromTricks(
          variant,
          [
            ['3', '2', 'A', 'K'],
            ['J', 'Q', '7', '6'],
            ['K', '4', '4', '4'],
          ],
          { scores: [abaixo, limiar] },
        ),
      };
      const r = applyMatchAction(s, { type: 'runSpecial', seat: 1 }, mulberry32(3));
      if (!r.ok) throw new Error(r.error.code);
      expect(r.state.scores).toEqual([abaixo + base, limiar]);
      return r.state.hand.special;
    };
    expect(next(true)).toBe('maoDeFerro');
    expect(next(false)).toBe('normal');
  });

  it('a opção atravessa a série, inclusive o jogo 2 do bo3', () => {
    const s = startSeries({
      variant,
      config: { format: 'bo3', ironHand: false },
      rng: mulberry32(4),
    });
    expect(s.state.match.ironHand).toBe(false);
    const g2 = startSeries({ variant, config: { format: 'bo3' }, rng: mulberry32(4) });
    expect(g2.state.match.ironHand).toBe(true);
  });
});
