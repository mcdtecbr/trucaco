import type { Rank } from './cards';
import { describe, expect, it } from 'vitest';
import { applyHandAction } from './hand';
import type { HandAction, HandState } from './hand';
import { firstCard, handFromTricks, must, playFirstCards } from './testing';
import { teamOf } from './types';
import { MINEIRO, PAULISTA } from './variant';
import type { Variant } from './variant';

const R: Rank[][] = [
  ['3', '2', 'A', 'K'],
  ['J', 'Q', '7', '6'],
  ['4', '4', '4', '4'],
];
const hand = (v: Variant) => handFromTricks(v, R);
const code = (s: HandState, a: HandAction) => {
  const r = applyHandAction(s, a);
  return r.ok ? 'OK' : r.error.code;
};

describe.each([
  [PAULISTA, [3, 6, 9, 12], 1],
  [MINEIRO, [4, 6, 8, 10, 12], 2],
] as const)('escada de apostas %s', (variant, ladder, base) => {
  it('sobe degrau a degrau, alternando as duplas, até o topo', () => {
    let s = hand(variant);
    expect(s.value).toBe(base);
    for (const value of ladder) {
      // avança até a vez de uma dupla que pode pedir
      let guard = 0;
      while (s.lastRaiserTeam === teamOf(s.turn) && guard++ < 3) s = playFirstCards(s, 1);
      s = must(s, { type: 'callBet', seat: s.turn });
      const responder = (s.turn + 1) % 4;
      s = must(s, { type: 'acceptBet', seat: responder });
      expect(s.value).toBe(value);
    }
    let guard = 0;
    while (teamOf(s.turn) !== s.lastRaiserTeam && guard++ < 3) s = playFirstCards(s, 1);
    const other = teamOf(s.turn) === 0 ? 1 : 0;
    s = playFirstCards(s, 1);
    expect(teamOf(s.turn)).toBe(other);
    expect(code(s, { type: 'callBet', seat: s.turn })).toBe('BET_NOT_ALLOWED');
  });

  it('correr dá à dupla que pediu o valor anterior ao pedido', () => {
    const s = must(hand(variant), { type: 'callBet', seat: 0 });
    const ran = must(s, { type: 'runBet', seat: 1 });
    expect(ran.result).toEqual({ winnerTeam: 0, points: base, reason: 'betRun' });

    // aceito o primeiro, o adversário pede o segundo e a dupla 0 corre: dupla 1 leva o primeiro valor
    let t = must(must(hand(variant), { type: 'callBet', seat: 0 }), { type: 'acceptBet', seat: 3 });
    t = playFirstCards(t, 1);
    t = must(t, { type: 'callBet', seat: 1 });
    const ran2 = must(t, { type: 'runBet', seat: 2 });
    expect(ran2.result).toEqual({ winnerTeam: 1, points: ladder[0], reason: 'betRun' });
  });

  it('quem responde pode aumentar; a decisão volta a quem pediu primeiro', () => {
    let s = must(hand(variant), { type: 'callBet', seat: 0 });
    s = must(s, { type: 'raiseBet', seat: 3 });
    expect(s.pending).toMatchObject({ fromTeam: 1, toLevel: 1 });
    expect(s.value).toBe(base); // nada aceito ainda
    expect(code(s, { type: 'acceptBet', seat: 3 })).toBe('NOT_YOUR_TURN');
    const done = must(s, { type: 'acceptBet', seat: 2 });
    expect(done.value).toBe(ladder[1]);
    expect(done.phase).toBe('playing');
    // a dupla 0 não foi a última a aumentar: pode pedir o próximo
    expect(code(done, { type: 'callBet', seat: 0 })).toBe('OK');
  });

  it('correr após aumento paga o valor da última aposta aceita (a base)', () => {
    let s = must(hand(variant), { type: 'callBet', seat: 0 });
    s = must(s, { type: 'raiseBet', seat: 1 });
    const ran = must(s, { type: 'runBet', seat: 0 });
    expect(ran.result).toEqual({ winnerTeam: 1, points: base, reason: 'betRun' });
  });

  it('a mão vence com o valor aceito', () => {
    let s = must(must(hand(variant), { type: 'callBet', seat: 0 }), { type: 'acceptBet', seat: 1 });
    s = playFirstCards(s, 8);
    expect(s.result).toEqual({ winnerTeam: 0, points: ladder[0], reason: 'tricks' });
  });

  it('não aumenta quem foi o último a aumentar, nem fora do turno, nem em aposta pendente', () => {
    let s = must(hand(variant), { type: 'callBet', seat: 0 });
    expect(code(s, { type: 'callBet', seat: 0 })).toBe('BET_PENDING');
    expect(code(s, { type: 'playCard', seat: 0, card: firstCard(s, 0) })).toBe('BET_PENDING');
    expect(code(s, { type: 'acceptBet', seat: 2 })).toBe('NOT_YOUR_TURN');
    s = must(s, { type: 'acceptBet', seat: 1 });
    expect(code(s, { type: 'callBet', seat: 1 })).toBe('NOT_YOUR_TURN');
    expect(code(s, { type: 'callBet', seat: 0 })).toBe('BET_NOT_ALLOWED');
    s = playFirstCards(s, 2); // 0 e 1 jogam; vez do 2, mesma dupla do último aumento
    expect(code(s, { type: 'callBet', seat: 2 })).toBe('BET_NOT_ALLOWED');
    expect(code(hand(variant), { type: 'acceptBet', seat: 1 })).toBe('NO_PENDING_BET');
  });

  it('não há aumento acima do topo da escada', () => {
    let s = hand(variant);
    s = must(s, { type: 'callBet', seat: 0 });
    let from = 1;
    for (let i = 1; i < ladder.length; i++) {
      s = must(s, { type: 'raiseBet', seat: from });
      from = 1 - from;
    }
    expect(code(s, { type: 'raiseBet', seat: from })).toBe('BET_NOT_ALLOWED');
  });
});
