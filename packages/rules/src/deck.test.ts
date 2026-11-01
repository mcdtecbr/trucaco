import { describe, expect, it } from 'vitest';
import { createDeck, deal, shuffle } from './deck';
import { mulberry32 } from './rng';

describe('baralho', () => {
  it('tem 40 cartas únicas sem 8, 9 e 10', () => {
    const deck = createDeck();
    expect(deck).toHaveLength(40);
    expect(new Set(deck.map((c) => `${c.rank}${c.suit}`)).size).toBe(40);
    expect(deck.some((c) => ['8', '9', '10'].includes(c.rank))).toBe(false);
  });

  it('embaralhar com a mesma seed é determinístico e não muta o baralho original', () => {
    const deck = createDeck();
    const copy = [...deck];
    expect(shuffle(deck, mulberry32(7))).toEqual(shuffle(deck, mulberry32(7)));
    expect(shuffle(deck, mulberry32(7))).not.toEqual(shuffle(deck, mulberry32(8)));
    expect(deck).toEqual(copy);
  });

  it('distribui 3 cartas distintas por assento e uma vira', () => {
    for (const seats of [4, 6]) {
      const { hands, vira } = deal(shuffle(createDeck(), mulberry32(1)), seats);
      expect(hands).toHaveLength(seats);
      const all = [...hands.flat(), vira];
      expect(all).toHaveLength(seats * 3 + 1);
      expect(new Set(all.map((c) => `${c.rank}${c.suit}`)).size).toBe(all.length);
      hands.forEach((h) => expect(h).toHaveLength(3));
    }
  });
});
