import { describe, expect, it } from 'vitest';
import { cardSizes, trickFootprint } from '@trucaco/ui';
import { SEAT_AVATAR_SIZE, SEAT_AVATAR_TIGHT, TIGHT_LANDSCAPE_HEIGHT } from '../screens/SeatAvatar';
import { dealTargets, FELT_INSET } from './DealOverlay';
import {
  DECK_GROUP_H,
  crossHeight,
  flexZones,
  trickFitScale,
  trickAdLayout,
  AD_MIN_TRICK_SCALE,
  AD_PLATE_MARGIN,
  AD_PLATE_MAX_H,
  DECK_GROUP_W,
  FELT_PAD,
  RING_PX,
  NAME_BLOCK,
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
    const a = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
    const g = landscapeGeometry(w, h, a);

    it(`${W}x${H}: parceiro, adversarios, vaza, monte com a vira e status nao colidem (apelidos incluidos)`, () => {
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
      for (const r of [g.partner.all, g.left.all, g.right.all, g.deckGroup, g.status]) {
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
  it('reduz a vaza em vez de descer sobre a madeira ou a dock', () => {
    for (const [W, H] of LANDSCAPES) {
      const { w, h } = estimateArena('landscape', W, H);
      for (const cut of [0, 16, 32]) {
        // Abaixo disso (apelido + avatar + vaza minima) a mesa troca para o avatar menor, pela altura
        // da janela (caso `568x320`, coberto acima); aqui so se simula a perda de altura com o avatar normal.
        if (cut > 0 && h - cut < 140) continue;
        const avatar = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
        const g = landscapeGeometry(w, h - cut, avatar);
        expect(g.trickScale, `${W}x${H} -${cut}`).toBeGreaterThanOrEqual(0.5);
        expect(g.trick.y + g.trick.h).toBeLessThanOrEqual(h - cut + FELT_PAD);
        expect(g.status.w).toBeGreaterThanOrEqual(STATUS_MIN_W);
      }
    }
  });
});

describe('apelido sob o avatar e vira sob o monte', () => {
  for (const [W, H] of LANDSCAPES) {
    it(`${W}x${H}: a caixa do assento inclui o apelido e a vira fica logo abaixo do monte`, () => {
      const { w, h } = estimateArena('landscape', W, H);
      const a = H < TIGHT_LANDSCAPE_HEIGHT ? SEAT_AVATAR_TIGHT : SEAT_AVATAR_SIZE.landscape;
      const g = landscapeGeometry(w, h, a);
      for (const s of [g.partner, g.left, g.right]) {
        expect(s.all.h).toBe(s.avatar.h + NAME_BLOCK);
      }
      // A vaza comeca abaixo do apelido do parceiro.
      expect(g.trick.y).toBeGreaterThanOrEqual(g.partner.all.y + g.partner.all.h);
      // Vira: sai por baixo do monte (comeca no meio dele e termina abaixo) e fica na caixa do grupo.
      expect(g.vira.y).toBeGreaterThan(g.deck.y);
      expect(g.vira.y).toBeLessThan(g.deck.y + g.deck.h);
      expect(g.vira.y + g.vira.h).toBeGreaterThan(g.deck.y + g.deck.h);
      expect(g.vira.x).toBeGreaterThan(g.deck.x);
      expect(g.deckGroup.w).toBe(DECK_GROUP_W);
      expect(g.deckGroup.h).toBe(DECK_GROUP_H);
      expect(g.vira.x + g.vira.w).toBeLessThanOrEqual(g.deckGroup.x + g.deckGroup.w);
    });
  }
});

describe('retrato baixo (avatar menor, abaixo de SHORT_PHONE_HEIGHT)', () => {
  const SHORT_AVATAR = SEAT_AVATAR_TIGHT + 4;
  for (const [W, H] of [
    [360, 640],
    [393, 679],
  ] as const) {
    it(`${W}x${H}: monte com a vira nao encosta nos avatares; vaza cabe entre parceiro e meu avatar`, () => {
      const { w, h } = estimateArena('phone', W, H);
      const r = phoneRects(w, h, SHORT_AVATAR);
      expect(overlaps(r.deckGroup, r.left, 4)).toBe(false);
      expect(overlaps(r.deckGroup, r.right, 4)).toBe(false);
      expect(overlaps(r.deckGroup, r.partner, 4)).toBe(false);
      const zones = flexZones(SHORT_AVATAR, true);
      const foot = trickFootprint('sm', 'cross').width;
      const box = SHORT_AVATAR + 2 * RING_PX;
      const fit = trickFitScale(h, zones, cardSizes.sm.height, 1, {
        arenaW: w,
        avatarBox: box,
        footW: foot,
      });
      // Largura: a cruz com o leque não encosta nos avatares laterais.
      expect(foot * fit + 2 * box).toBeLessThanOrEqual(w);
      // A cruz (escalada) cabe na faixa livre entre o parceiro e o meu avatar.
      expect(crossHeight(cardSizes.sm.height) * fit).toBeLessThanOrEqual(
        h - zones.partnerZone - zones.mineZone + 0.5,
      );
      expect(fit).toBeGreaterThanOrEqual(0.6);
    });
  }
});

describe('trickAdLayout: a vaza não cobre a placa quando há espaço', () => {
  const played = cardSizes.md.height;
  const zones = flexZones(76, true);

  it('tela alta: a placa sobe para a faixa acima da cruz, sem encostar na vaza nem no parceiro', () => {
    const arenaH = 1000;
    const r = trickAdLayout(arenaH, zones, played, 1);
    expect(r.scale).toBe(1);
    const plate = Math.min(arenaH * 0.45, AD_PLATE_MAX_H);
    const zone = arenaH - zones.partnerZone - zones.mineZone;
    const crossTop = zones.partnerZone + (zone - crossHeight(played) * r.scale) / 2;
    const plateCenter = arenaH / 2 + r.offsetY;
    expect(plateCenter + plate / 2 + AD_PLATE_MARGIN / 2).toBeLessThanOrEqual(crossTop);
    expect(plateCenter - plate / 2).toBeGreaterThanOrEqual(zones.partnerZone);
  });

  it('falta pouco: a cruz encolhe (até o mínimo) para abrir a faixa', () => {
    // Altura em que a cruz inteira não deixaria faixa para a placa, mas a 90% deixa.
    const plate = AD_PLATE_MAX_H + AD_PLATE_MARGIN;
    const arenaH = 2 * plate + crossHeight(played) * 0.9 + zones.partnerZone + zones.mineZone;
    const r = trickAdLayout(arenaH, zones, played, 1);
    expect(r.scale).toBeLessThan(1);
    expect(r.scale).toBeGreaterThanOrEqual(AD_MIN_TRICK_SCALE);
    expect(r.offsetY).toBeLessThan(0);
  });

  it('tela realmente apertada: nada muda (a placa fica no centro e a vaza a cobre)', () => {
    expect(trickAdLayout(420, flexZones(52, true), played, 0.8)).toEqual({
      scale: 0.8,
      offsetY: 0,
    });
  });
});
