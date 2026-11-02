import type { Rank } from './cards';
import { describe, expect, it } from 'vitest';
import { botAction } from './bot';
import { applyHandAction } from './hand';
import type { HandAction, HandState } from './hand';
import { legalActions } from './legal';
import { handFromTricks, must, playFirstCards } from './testing';
import { MINEIRO, PAULISTA } from './variant';
import type { Variant } from './variant';
import { viewFor } from './view';

const R: Rank[][] = [
  ['3', '2', 'A', 'K'],
  ['J', 'Q', '7', '6'],
  ['4', '4', '4', '4'],
];
const BET_TYPES = ['acceptBet', 'runBet', 'raiseBet'] as const;
const code = (s: HandState, a: HandAction) => {
  const r = applyHandAction(s, a);
  return r.ok ? 'OK' : r.error.code;
};
const betTypes = (s: HandState, seat: number) =>
  legalActions(s, seat)
    .map((a) => a.type)
    .filter((t) => (BET_TYPES as readonly string[]).includes(t));
/** Mão em que `seat` é o da vez (o pé é o assento anterior). */
const turnOf = (variant: Variant, seat: number, scores?: readonly [number, number]) =>
  handFromTricks(variant, R, { pe: (seat + 3) % 4, ...(scores ? { scores } : {}) });

describe.each([[PAULISTA], [MINEIRO]] as const)('quem responde à aposta %s', (variant) => {
  const top = variant.betLadder.length - 1;

  it.each([0, 1, 2, 3])('truco pedido pelo assento %i: responde o próximo da mesa', (caller) => {
    const s = must(turnOf(variant, caller), { type: 'callBet', seat: caller });
    const responder = (caller + 1) % 4;
    expect(s.pending?.responderSeat).toBe(responder);
    for (let seat = 0; seat < 4; seat++) {
      const types = betTypes(s, seat);
      if (seat === responder) expect(types).toEqual(['acceptBet', 'runBet', 'raiseBet']);
      else expect(types).toEqual([]);
    }
    // o parceiro de quem responde e quem pediu (com seu parceiro) são rejeitados
    for (const seat of [(caller + 2) % 4, (caller + 3) % 4, caller]) {
      for (const type of BET_TYPES)
        expect(code(s, { type, seat } as HandAction)).toBe('NOT_YOUR_TURN');
    }
    expect(code(s, { type: 'acceptBet', seat: responder })).toBe('OK');
  });

  it.each([0, 1, 2, 3])('aumentos alternam o respondedor (pedinte inicial %i)', (caller) => {
    let s = must(turnOf(variant, caller), { type: 'callBet', seat: caller });
    let asker = caller;
    let responder = (caller + 1) % 4;
    for (let level = 1; level <= top; level++) {
      expect(s.pending?.responderSeat).toBe(responder);
      s = must(s, { type: 'raiseBet', seat: responder });
      // quem responde agora é quem fez o pedido anterior
      expect(s.pending).toMatchObject({ fromSeat: responder, responderSeat: asker });
      expect(betTypes(s, (asker + 2) % 4)).toEqual([]);
      expect(betTypes(s, (responder + 2) % 4)).toEqual([]);
      expect(code(s, { type: 'acceptBet', seat: (asker + 2) % 4 })).toBe('NOT_YOUR_TURN');
      [asker, responder] = [responder, asker];
    }
    // no topo só aceitar ou correr
    expect(betTypes(s, responder)).toEqual(['acceptBet', 'runBet']);
    expect(must(s, { type: 'acceptBet', seat: responder }).value).toBe(
      variant.betLadder[top] as number,
    );
  });

  it('aumento depois de aposta aceita é respondido por quem pediu o anterior', () => {
    // 0 pede truco, 1 aceita; na vez do 3 (mesma dupla do 1) ele pede o aumento: responde o 0
    let s = must(turnOf(variant, 0), { type: 'callBet', seat: 0 });
    s = must(s, { type: 'acceptBet', seat: 1 });
    s = playFirstCards(s, 3); // 0, 1, 2 jogam; vez do 3
    expect(s.turn).toBe(3);
    s = must(s, { type: 'callBet', seat: 3 });
    expect(s.pending?.responderSeat).toBe(0);
    expect(betTypes(s, 2)).toEqual([]);
    expect(betTypes(s, 0)).toContain('acceptBet');
    expect(code(s, { type: 'runBet', seat: 2 })).toBe('NOT_YOUR_TURN');
    expect(must(s, { type: 'runBet', seat: 0 }).result?.winnerTeam).toBe(1);
  });

  it('a visão expõe o pedido pendente com o respondedor', () => {
    const s = must(turnOf(variant, 2), { type: 'callBet', seat: 2 });
    expect(viewFor(s, 0).pending?.responderSeat).toBe(3);
  });

  it('o bot só age como respondedor e corre', () => {
    const s = must(turnOf(variant, 0), { type: 'callBet', seat: 0 });
    expect(botAction(s, 1)).toEqual({ type: 'runBet', seat: 1 });
    expect(botAction(s, 3)).toBeNull();
    expect(botAction(s, 2)).toBeNull();
    expect(botAction(s, 0)).toBeNull();
  });
});

describe.each([
  [PAULISTA, 11, 1, 3],
  [MINEIRO, 10, 2, 4],
] as const)('onze/dez decidido pelos dois %s', (variant, limiar, base, primeiro) => {
  const mk = (scores: readonly [number, number] = [limiar, 3]) => turnOf(variant, 0, scores);
  const types = (s: HandState, seat: number) => legalActions(s, seat).map((a) => a.type);

  it('os dois precisam aceitar, em qualquer ordem', () => {
    for (const [a, b] of [
      [0, 2],
      [2, 0],
    ] as const) {
      let s = mk();
      expect(types(s, 0)).toEqual(['playSpecial', 'runSpecial']);
      expect(types(s, 2)).toEqual(['playSpecial', 'runSpecial']);
      expect(types(s, 1)).toEqual([]);
      s = must(s, { type: 'playSpecial', seat: a });
      expect(s.phase).toBe('specialDecision');
      expect(s.specialAccepted).toEqual([a]);
      expect(viewFor(s, b).specialAccepted).toEqual([a]);
      s = must(s, { type: 'playSpecial', seat: b });
      expect(s.phase).toBe('playing');
      expect(s.value).toBe(primeiro);
      expect(s.betsLocked).toBe(true);
      expect(s.specialAccepted).toEqual([a, b]);
    }
  });

  it('quem já aceitou fica sem ações; o parceiro ainda decide', () => {
    const s = must(mk(), { type: 'playSpecial', seat: 0 });
    expect(types(s, 0)).toEqual([]);
    expect(types(s, 2)).toEqual(['playSpecial', 'runSpecial']);
    expect(code(s, { type: 'runSpecial', seat: 0 })).toBe('NOT_YOUR_TURN');
    expect(code(s, { type: 'playSpecial', seat: 0 })).toBe('NOT_YOUR_TURN');
    expect(code(s, { type: 'playSpecial', seat: 1 })).toBe('NOT_YOUR_TURN');
    // as cartas continuam visíveis à dupla enquanto decide
    expect(viewFor(s, 2).partnerHands[0]).toEqual(s.hands[0]);
  });

  it('o primeiro a correr resolve na hora e a adversária ganha o valor base', () => {
    for (const seat of [0, 2]) {
      const s = must(mk(), { type: 'runSpecial', seat });
      expect(s.phase).toBe('finished');
      expect(s.result).toEqual({ winnerTeam: 1, points: base, reason: 'specialRun' });
    }
  });

  it('o segundo corre depois de o primeiro aceitar: a dupla corre', () => {
    const s = must(must(mk(), { type: 'playSpecial', seat: 2 }), { type: 'runSpecial', seat: 0 });
    expect(s.result).toEqual({ winnerTeam: 1, points: base, reason: 'specialRun' });
  });

  it('dupla 1 na frente funciona igual', () => {
    let s = mk([3, limiar]);
    expect(s.specialTeam).toBe(1);
    s = must(must(s, { type: 'playSpecial', seat: 3 }), { type: 'playSpecial', seat: 1 });
    expect(s.phase).toBe('playing');
    const r = must(mk([3, limiar]), { type: 'runSpecial', seat: 3 });
    expect(r.result?.winnerTeam).toBe(0);
  });

  it('bot aceita e depois não age mais', () => {
    let s = mk();
    expect(botAction(s, 0)).toEqual({ type: 'playSpecial', seat: 0 });
    s = must(s, { type: 'playSpecial', seat: 0 });
    expect(botAction(s, 0)).toBeNull();
    expect(botAction(s, 2)).toEqual({ type: 'playSpecial', seat: 2 });
  });

  it('mão de ferro segue sem decisão e sem aposta', () => {
    const s = mk([limiar, limiar]);
    expect(s.special).toBe('maoDeFerro');
    expect(s.phase).toBe('playing');
    expect(s.specialAccepted).toEqual([]);
    expect(legalActions(s, s.turn).map((a) => a.type)).not.toContain('callBet');
    expect(code(s, { type: 'playSpecial', seat: 0 })).toBe('NO_SPECIAL_DECISION');
  });
});
