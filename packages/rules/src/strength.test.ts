import type { Card, Rank, Suit } from './cards';
import { describe, expect, it } from 'vitest';
import { cardStrength, compareCards, isManilha, manilhaRank } from './strength';
import { MINEIRO, PAULISTA } from './variant';

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

describe('hierarquia Paulista', () => {
  it('manilha é a carta imediatamente superior à vira', () => {
    expect(manilhaRank(PAULISTA, c('4', 'ouros'))).toBe('5');
    expect(manilhaRank(PAULISTA, c('7', 'paus'))).toBe('Q');
    expect(manilhaRank(PAULISTA, c('K', 'copas'))).toBe('A');
  });

  it('vira 3 faz do 4 a manilha (circular)', () => {
    expect(manilhaRank(PAULISTA, c('3', 'paus'))).toBe('4');
  });

  it('manilhas se ordenam por naipe: zap > copas > espadas > ouros', () => {
    const vira = c('K', 'ouros'); // manilha A
    const s = (suit: Suit) => cardStrength(PAULISTA, vira, c('A', suit));
    expect(s('paus')).toBeGreaterThan(s('copas'));
    expect(s('copas')).toBeGreaterThan(s('espadas'));
    expect(s('espadas')).toBeGreaterThan(s('ouros'));
  });

  it('manilha vence o 3, e cartas comuns seguem 3>2>A>K>J>Q>7>6>5>4', () => {
    const vira = c('4', 'paus'); // manilha 5
    expect(compareCards(PAULISTA, vira, c('5', 'ouros'), c('3', 'paus'))).toBeGreaterThan(0);
    const order: Rank[] = ['3', '2', 'A', 'K', 'J', 'Q', '7', '6'];
    for (let i = 0; i + 1 < order.length; i++) {
      expect(
        compareCards(
          PAULISTA,
          vira,
          c(order[i] as Rank, 'copas'),
          c(order[i + 1] as Rank, 'copas'),
        ),
      ).toBeGreaterThan(0);
    }
  });

  it('cartas comuns iguais de naipes diferentes empatam', () => {
    expect(compareCards(PAULISTA, c('4', 'paus'), c('3', 'copas'), c('3', 'ouros'))).toBe(0);
  });

  it('com vira, o rank que era manilha deixa de ser comum', () => {
    expect(isManilha(PAULISTA, c('2', 'paus'), c('3', 'ouros'))).toBe(true);
    expect(isManilha(PAULISTA, c('2', 'paus'), c('2', 'ouros'))).toBe(false);
  });
});

describe('hierarquia Mineiro', () => {
  it('manilhas fixas: 4♣ > 7♥ > A♠ > 7♦', () => {
    const s = (card: Card) => cardStrength(MINEIRO, null, card);
    expect(s(c('4', 'paus'))).toBeGreaterThan(s(c('7', 'copas')));
    expect(s(c('7', 'copas'))).toBeGreaterThan(s(c('A', 'espadas')));
    expect(s(c('A', 'espadas'))).toBeGreaterThan(s(c('7', 'ouros')));
    expect(s(c('7', 'ouros'))).toBeGreaterThan(s(c('3', 'paus')));
  });

  it('7 e A de outros naipes são comuns', () => {
    expect(isManilha(MINEIRO, null, c('7', 'paus'))).toBe(false);
    expect(isManilha(MINEIRO, null, c('A', 'copas'))).toBe(false);
    expect(compareCards(MINEIRO, null, c('A', 'copas'), c('K', 'copas'))).toBeGreaterThan(0);
    expect(compareCards(MINEIRO, null, c('3', 'copas'), c('7', 'paus'))).toBeGreaterThan(0);
  });
});
