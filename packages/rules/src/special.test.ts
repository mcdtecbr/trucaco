import type { Card, Rank } from './cards';
import { describe, expect, it } from 'vitest';
import { applyHandAction } from './hand';
import type { HandAction, HandState } from './hand';
import { handFromTricks, must, playFirstCards } from './testing';
import { MINEIRO, PAULISTA } from './variant';
import type { Variant } from './variant';
import { viewFor } from './view';

const R: Rank[][] = [
  ['3', '2', 'A', 'K'],
  ['J', 'Q', '7', '6'],
  ['K', '4', '4', '4'],
];
const code = (s: HandState, a: HandAction) => {
  const r = applyHandAction(s, a);
  return r.ok ? 'OK' : r.error.code;
};

describe.each([
  [PAULISTA, 11, 1, 3],
  [MINEIRO, 10, 2, 4],
] as const)('mão de onze/dez %s', (variant: Variant, limiar, base, primeiro) => {
  const mk = (scores: readonly [number, number]) => handFromTricks(variant, R, { scores });

  it('dupla no limiar decide antes de qualquer jogada', () => {
    const s = mk([limiar, 3]);
    expect(s.special).toBe('maoDeOnze');
    expect(s.phase).toBe('specialDecision');
    expect(s.specialTeam).toBe(0);
    expect(code(s, { type: 'playCard', seat: s.turn, card: s.hands[s.turn]?.[0] as Card })).toBe(
      'SPECIAL_DECISION_PENDING',
    );
    expect(code(s, { type: 'callBet', seat: s.turn })).toBe('SPECIAL_DECISION_PENDING');
    expect(code(s, { type: 'playSpecial', seat: 1 })).toBe('NOT_YOUR_TURN');
    expect(mk([3, limiar]).specialTeam).toBe(1);
  });

  it('decide jogar: mão vale o primeiro degrau e não aceita aumentos', () => {
    let s = must(mk([limiar, 3]), { type: 'playSpecial', seat: 2 });
    expect(s.value).toBe(primeiro);
    expect(s.phase).toBe('playing');
    expect(code(s, { type: 'callBet', seat: s.turn })).toBe('BET_NOT_ALLOWED');
    s = playFirstCards(s, 8);
    expect(s.result).toEqual({ winnerTeam: 0, points: primeiro, reason: 'tricks' });
  });

  it('decide correr: a adversária ganha o valor base', () => {
    const s = must(mk([limiar, 3]), { type: 'runSpecial', seat: 0 });
    expect(s.phase).toBe('finished');
    expect(s.result).toEqual({ winnerTeam: 1, points: base, reason: 'specialRun' });
    const t = must(mk([3, limiar]), { type: 'runSpecial', seat: 1 });
    expect(t.result).toEqual({ winnerTeam: 0, points: base, reason: 'specialRun' });
  });

  it('a dupla na frente vê as cartas do parceiro; os adversários não veem nada', () => {
    const s = mk([limiar, 3]);
    expect(Object.keys(viewFor(s, 0).partnerHands)).toEqual(['2']);
    expect(viewFor(s, 0).partnerHands[2]).toEqual(s.hands[2]);
    expect(viewFor(s, 1).partnerHands).toEqual({});
    const playing = must(s, { type: 'playSpecial', seat: 0 });
    expect(viewFor(playing, 0).partnerHands).toEqual({});
  });

  it('outro placar (ninguém no limiar) é mão normal', () => {
    const s = mk([limiar - 1, 0]);
    expect(s.special).toBe('normal');
    expect(s.phase).toBe('playing');
  });
});

describe.each([
  [PAULISTA, 11, 1],
  [MINEIRO, 10, 2],
] as const)('mão de ferro %s', (variant: Variant, limiar, base) => {
  const mk = () => handFromTricks(variant, R, { scores: [limiar, limiar] });

  it('vale o base, sem decisão e sem truco', () => {
    const s = mk();
    expect(s.special).toBe('maoDeFerro');
    expect(s.phase).toBe('playing');
    expect(s.value).toBe(base);
    expect(code(s, { type: 'callBet', seat: s.turn })).toBe('BET_NOT_ALLOWED');
  });

  it('cartas só às cegas (por posição); ninguém vê as próprias cartas', () => {
    const s = mk();
    expect(code(s, { type: 'playCard', seat: 0, card: s.hands[0]?.[0] as Card })).toBe(
      'BLIND_ONLY',
    );
    expect(viewFor(s, 0).ownHand).toBeNull();
    expect(viewFor(s, 0).handSizes).toEqual([3, 3, 3, 3]);
    expect(code(s, { type: 'playBlindCard', seat: 0, index: 3 })).toBe('CARD_NOT_IN_HAND');
  });

  it('a mão é decidida pela força real das cartas, valendo o base', () => {
    let s = mk();
    for (let i = 0; i < 12 && s.phase !== 'finished'; i++) {
      s = must(s, { type: 'playBlindCard', seat: s.turn, index: 0 });
    }
    expect(s.result).toEqual({ winnerTeam: 0, points: base, reason: 'tricks' });
  });

  it('jogar às cegas fora da mão de ferro é ilegal', () => {
    const s = handFromTricks(variant, R);
    expect(code(s, { type: 'playBlindCard', seat: 0, index: 0 })).toBe('NOT_BLIND_HAND');
  });
});
