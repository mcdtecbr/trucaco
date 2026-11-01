import type { Rank } from './cards';
import { describe, expect, it } from 'vitest';
import { applyHandAction, startHand, startHandFromCards } from './hand';
import { mulberry32 } from './rng';
import { firstCard, handFromTricks, must, playFirstCards } from './testing';
import { PAULISTA } from './variant';

// Paulista, vira 4♦ => manilha 5 (evitada nos cenários). Pé = 3, mão = 0.
// Duplas: 0 = assentos 0 e 2; 1 = assentos 1 e 3. tricks[vaza] = [a0, a1, a2, a3].
const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x)) as X;
const T = (...t: Rank[][]) => handFromTricks(PAULISTA, t);

describe('pé e mão', () => {
  it('o mão é o assento seguinte ao pé e começa a 1ª vaza', () => {
    const s = startHand({ variant: PAULISTA, pe: 3, rng: mulberry32(1) });
    expect(s.turn).toBe(0);
    const s2 = startHand({ variant: PAULISTA, pe: 0, rng: mulberry32(1) });
    expect(s2.turn).toBe(1);
    expect(s.hands.map((h) => h.length)).toEqual([3, 3, 3, 3]);
    expect(s.vira).not.toBeNull();
  });

  it('quem vence a vaza começa a próxima', () => {
    const s = playFirstCards(
      T(['4', '3', '4', '4'], ['K', 'K', 'K', 'K'], ['Q', 'Q', 'Q', 'Q']),
      4,
    );
    expect(s.tricks[0]?.winnerSeat).toBe(1);
    expect(s.turn).toBe(1);
    expect(s.phase).toBe('playing');
  });
});

describe('vencedor da vaza', () => {
  it('parceiros com cartas iguais e mais fortes vencem a vaza (não empata)', () => {
    const s = playFirstCards(
      T(['3', '2', '3', '4'], ['K', 'K', 'K', 'K'], ['Q', 'Q', 'Q', 'Q']),
      4,
    );
    expect(s.tricks[0]?.winnerTeam).toBe(0);
    expect(s.tricks[0]?.winnerSeat).toBe(0);
  });

  it('carta coberta perde de qualquer carta aberta', () => {
    let s = T(['3', '3', '3', '3'], ['K', 'J', '4', '4'], ['Q', 'Q', 'Q', 'Q']);
    s = playFirstCards(s, 4); // 1ª vaza empatada: assento 0 começa de novo
    s = must(s, { type: 'playCard', seat: 0, card: firstCard(s, 0), covered: true });
    s = playFirstCards(s, 3);
    expect(s.tricks[1]?.winnerSeat).toBe(1);
  });
});

describe('empates em vaza', () => {
  it('empate na primeira vaza dá a mão a quem vence a segunda', () => {
    const s = playFirstCards(
      T(['3', '3', '4', '4'], ['4', 'K', '4', 'Q'], ['6', '6', '6', '6']),
      8,
    );
    expect(s.phase).toBe('finished');
    expect(s.tricks).toHaveLength(2);
    expect(s.result).toEqual({ winnerTeam: 1, points: 1, reason: 'tricks' });
  });

  it('empate na primeira e na segunda dá a mão a quem vence a terceira', () => {
    const s = playFirstCards(
      T(['3', '3', '4', '4'], ['K', 'K', '4', '4'], ['J', 'Q', 'Q', 'Q']),
      12,
    );
    expect(s.tricks.map((t) => t.winnerTeam)).toEqual([null, null, 0]);
    expect(s.result).toEqual({ winnerTeam: 0, points: 1, reason: 'tricks' });
  });

  it('empate nas três vazas: ninguém pontua', () => {
    const s = playFirstCards(
      T(['3', '3', '4', '4'], ['K', 'K', '6', '6'], ['J', 'J', '7', '7']),
      12,
    );
    expect(s.phase).toBe('finished');
    expect(s.result).toEqual({ winnerTeam: null, points: 0, reason: 'draw' });
  });

  it('primeira vencida e segunda empatada: leva quem venceu a primeira', () => {
    const s = playFirstCards(
      T(['3', '2', '4', '4'], ['K', 'K', '4', '4'], ['Q', 'Q', 'Q', 'Q']),
      8,
    );
    expect(s.tricks.map((t) => t.winnerTeam)).toEqual([0, null]);
    expect(s.phase).toBe('finished');
    expect(s.result).toEqual({ winnerTeam: 0, points: 1, reason: 'tricks' });
  });

  it('primeira e segunda de duplas diferentes e terceira empatada: leva quem venceu a primeira', () => {
    const s = playFirstCards(
      T(['3', '2', '4', '4'], ['4', 'K', '6', 'Q'], ['J', 'J', '7', '7']),
      12,
    );
    expect(s.tricks.map((t) => t.winnerTeam)).toEqual([0, 1, null]);
    expect(s.result).toEqual({ winnerTeam: 0, points: 1, reason: 'tricks' });
  });

  it('mesma dupla vence as duas primeiras: a mão acaba sem terceira vaza', () => {
    const s = playFirstCards(
      T(['3', '2', '4', '4'], ['K', 'J', '4', '4'], ['J', 'Q', 'Q', 'Q']),
      8,
    );
    expect(s.phase).toBe('finished');
    expect(s.tricks).toHaveLength(2);
    expect(s.result?.winnerTeam).toBe(0);
  });

  it('duplas diferentes nas duas primeiras: a terceira decide', () => {
    const s = playFirstCards(
      T(['3', '2', '4', '4'], ['4', 'K', '6', 'Q'], ['Q', 'J', '7', '7']),
      12,
    );
    expect(s.tricks.map((t) => t.winnerTeam)).toEqual([0, 1, 1]);
    expect(s.result).toEqual({ winnerTeam: 1, points: 1, reason: 'tricks' });
  });

  it('em vaza empatada quem a iniciou começa a seguinte', () => {
    const s = playFirstCards(
      T(['3', '3', '4', '4'], ['K', 'K', '4', '4'], ['J', 'Q', 'Q', 'Q']),
      4,
    );
    expect(s.turn).toBe(0);
  });
});

describe('ações ilegais devolvem RuleError e não mutam', () => {
  const base = T(['3', '2', '4', '4'], ['K', 'K', '4', '4'], ['J', 'Q', 'Q', 'Q']);
  const code = (r: ReturnType<typeof applyHandAction>) => (r.ok ? 'OK' : r.error.code);

  it('fora do turno, carta alheia, coberta na 1ª vaza, assento inválido', () => {
    const snapshot = clone(base);
    const c0 = firstCard(base, 0);
    expect(code(applyHandAction(base, { type: 'playCard', seat: 1, card: c0 }))).toBe(
      'NOT_YOUR_TURN',
    );
    expect(
      code(applyHandAction(base, { type: 'playCard', seat: 0, card: firstCard(base, 1) })),
    ).toBe('CARD_NOT_IN_HAND');
    expect(
      code(applyHandAction(base, { type: 'playCard', seat: 0, card: c0, covered: true })),
    ).toBe('COVERED_NOT_ALLOWED');
    expect(code(applyHandAction(base, { type: 'playCard', seat: 9, card: c0 }))).toBe(
      'INVALID_SEAT',
    );
    expect(base).toEqual(snapshot);
  });

  it('jogar devolve novo estado e preserva o anterior', () => {
    const snapshot = clone(base);
    const next = must(base, { type: 'playCard', seat: 0, card: firstCard(base, 0) });
    expect(next).not.toBe(base);
    expect(base).toEqual(snapshot);
    expect(next.hands[0]).toHaveLength(2);
  });

  it('mão encerrada não aceita ações', () => {
    const s = playFirstCards(base, 8);
    expect(code(applyHandAction(s, { type: 'callBet', seat: s.turn }))).toBe('HAND_FINISHED');
  });
});

describe('simulação com RNG fixo', () => {
  it('mãos aleatórias sempre terminam com pontos coerentes', () => {
    for (let seed = 1; seed <= 200; seed++) {
      let s = playFirstCards(
        startHand({ variant: PAULISTA, pe: seed % 4, rng: mulberry32(seed) }),
        0,
      );
      let guard = 0;
      while (s.phase !== 'finished' && guard++ < 20) s = playFirstCards(s, 1);
      expect(s.result).not.toBeNull();
      expect(s.result?.points).toBe(s.result?.winnerTeam === null ? 0 : 1);
      expect(startHandFromCards).toBeDefined();
    }
  });
});
