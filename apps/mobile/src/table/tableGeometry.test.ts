import { describe, expect, it } from 'vitest';
import { SEAT_AVATAR_SIZE } from '../screens/SeatAvatar';
import { dealTargets, FELT_INSET } from './DealOverlay';
import {
  FELT_PAD,
  STATUS_MIN_W,
  estimateArena,
  landscapeFits,
  landscapeGeometry,
  landscapeParts,
  overlaps,
  phoneRects,
} from './tableGeometry';
import type { Rect } from './tableGeometry';

const LANDSCAPES: readonly (readonly [number, number])[] = [
  [844, 390],
  [667, 375],
  [740, 360],
  [640, 360],
  [568, 320],
];

describe('geometria do celular deitado', () => {
  for (const [W, H] of LANDSCAPES) {
    const { w, h } = estimateArena('landscape', W, H);
    const a = SEAT_AVATAR_SIZE.landscape;
    const g = landscapeGeometry(w, h, a);

    it(`${W}x${H}: parceiro, adversarios, vaza, vira, monte e status nao colidem`, () => {
      const named: [string, Rect][] = landscapeParts(g);
      for (let i = 0; i < named.length; i++) {
        for (let j = i + 1; j < named.length; j++) {
          const [na, ra] = named[i] as [string, Rect];
          const [nb, rb] = named[j] as [string, Rect];
          expect(overlaps(ra, rb, 2), `${na} x ${nb}`).toBe(false);
        }
      }
    });

    it(`${W}x${H}: tudo dentro da arena (a vaza usa a folga do pano) e status legivel`, () => {
      for (const r of [g.partner.all, g.left.all, g.right.all, g.deck, g.vira, g.status]) {
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(w);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.y + r.h).toBeLessThanOrEqual(h + FELT_PAD);
      }
      expect(g.trick.y + g.trick.h).toBeLessThanOrEqual(h + FELT_PAD);
      expect(g.status.w).toBeGreaterThanOrEqual(STATUS_MIN_W);
      expect(landscapeFits(g, h)).toBe(true);
    });

    it(`${W}x${H}: a distribuicao mira o avatar e o monte da geometria`, () => {
      const deck = {
        x: FELT_INSET + g.deck.x + g.deck.w / 2,
        y: FELT_INSET + g.deck.y + g.deck.h / 2,
      };
      const t = dealTargets(w + 2 * FELT_INSET, h + 2 * FELT_INSET, a, deck);
      expect(t.deck).toEqual(deck);
      expect(t.partner.x).toBeCloseTo(FELT_INSET + g.partner.avatar.x + g.partner.avatar.w / 2, 5);
      expect(t.left.y).toBeCloseTo(FELT_INSET + g.left.avatar.y + g.left.avatar.h / 2, 5);
    });
  }
});

describe('geometria deitada com pouca altura', () => {
  it('reduz vaza e vira em vez de descer sobre a madeira ou a dock', () => {
    for (const [W, H] of LANDSCAPES) {
      const { w, h } = estimateArena('landscape', W, H);
      for (const cut of [0, 16, 32]) {
        const g = landscapeGeometry(w, h - cut, SEAT_AVATAR_SIZE.landscape);
        if (cut > 0 && h - cut < 120) continue;
        expect(g.trickScale, `${W}x${H} -${cut}`).toBeGreaterThanOrEqual(0.5);
        expect(g.trick.y + g.trick.h).toBeLessThanOrEqual(h - cut + FELT_PAD);
        expect(g.status.w).toBeGreaterThanOrEqual(STATUS_MIN_W);
      }
    }
  });
});

describe('retrato 360x640', () => {
  it('a vira (tambem com a manilha em duas linhas) nao encosta no avatar da direita', () => {
    const { w, h } = estimateArena('phone', 360, 640);
    for (const viraH of [100, 128]) {
      const r = phoneRects(w, h, SEAT_AVATAR_SIZE.phone, viraH);
      expect(overlaps(r.vira, r.right, 4), `vira ${viraH}`).toBe(false);
      expect(overlaps(r.vira, r.partner, 4)).toBe(false);
    }
  });
});
