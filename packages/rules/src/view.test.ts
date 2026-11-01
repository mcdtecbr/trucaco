import { describe, expect, it } from 'vitest';
import { must, handFromTricks, firstCard } from './testing';
import { PAULISTA } from './variant';
import { viewFor } from './view';

describe('viewFor', () => {
  const s0 = handFromTricks(PAULISTA, [
    ['3', '2', 'A', 'K'],
    ['J', 'Q', '7', '6'],
    ['K', '4', '4', '4'],
  ]);

  it('mostra só as cartas do próprio assento', () => {
    const v = viewFor(s0, 1);
    expect(v.ownHand).toEqual(s0.hands[1]);
    const json = JSON.stringify(v);
    for (const seat of [0, 2, 3]) {
      for (const c of s0.hands[seat] ?? []) {
        expect(json).not.toContain(JSON.stringify(c));
      }
    }
  });

  it('carta coberta fica oculta para os outros e visível ao dono', () => {
    let s = s0;
    for (let i = 0; i < 4; i++)
      s = must(s, { type: 'playCard', seat: s.turn, card: firstCard(s, s.turn) });
    const seat = s.turn;
    s = must(s, { type: 'playCard', seat, card: firstCard(s, seat), covered: true });
    expect(viewFor(s, seat).current[0]?.card).not.toBeNull();
    expect(viewFor(s, (seat + 1) % 4).current[0]).toMatchObject({ covered: true, card: null });
  });
});
