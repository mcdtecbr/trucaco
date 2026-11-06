import { describe, expect, it } from 'vitest';
import { botAction, legalActions, MINEIRO, PAULISTA, mulberry32, pendingSeat } from './index';
import type { BotProfile, Card, HandAction, MatchState, Rng, Seat, Variant } from './index';
import { applyHandAction, startHandFromCards } from './hand';
import type { HandState } from './hand';
import { applyMatchAction, startMatch } from './match';
import { must } from './testing';

const c = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit });

/** Seat 0 pede truco; devolve a mão com a aposta pendente e o assento que responde. */
function trucoContra(
  variant: Variant,
  seat1: Card[],
  scores?: readonly [number, number],
): { state: HandState; responder: Seat } {
  const s = startHandFromCards({
    variant,
    pe: 3,
    scores,
    hands: [
      [c('Q', 'ouros'), c('J', 'ouros'), c('K', 'ouros')],
      seat1,
      [c('A', 'ouros'), c('7', 'ouros'), c('6', 'ouros')],
      [c('4', 'espadas'), c('6', 'espadas'), c('7', 'espadas')],
    ],
    vira: c('4', 'ouros'),
  });
  const state = must(s, { type: 'callBet', seat: s.turn });
  const responder = pendingSeat(state) as Seat;
  return { state, responder };
}

const FORTE = [c('5', 'paus'), c('3', 'copas'), c('2', 'copas')];
const FRACA = [c('4', 'copas'), c('6', 'copas'), c('7', 'copas')];

describe('bot de vaga: aposta por força da mão', () => {
  it('aceita aposta com manilha na mão', () => {
    const { state, responder } = trucoContra(PAULISTA, FORTE);
    expect(responder).toBe(1);
    expect(botAction(state, responder, undefined, 'vacancy')).toEqual({
      type: 'acceptBet',
      seat: 1,
    });
  });

  it('corre de aposta com mão fraca', () => {
    const { state, responder } = trucoContra(PAULISTA, FRACA);
    expect(botAction(state, responder, undefined, 'vacancy')).toEqual({
      type: 'runBet',
      seat: 1,
    });
  });

  it('perfil absence sempre corre, mesmo com mão forte (comportamento anterior)', () => {
    const { state, responder } = trucoContra(PAULISTA, FORTE);
    expect(botAction(state, responder)).toEqual({ type: 'runBet', seat: 1 });
    expect(botAction(state, responder, undefined, 'absence')).toEqual({ type: 'runBet', seat: 1 });
  });

  it('no Mineiro, manilha fixa também faz o bot de vaga aceitar', () => {
    const { state, responder } = trucoContra(MINEIRO, [
      c('4', 'paus'),
      c('7', 'ouros'),
      c('6', 'copas'),
    ]);
    expect(botAction(state, responder, undefined, 'vacancy')).toEqual({
      type: 'acceptBet',
      seat: responder,
    });
  });

  it('ruído do rng não vira ação ilegal e é determinístico por seed', () => {
    const { state, responder } = trucoContra(PAULISTA, FORTE);
    const a = botAction(state, responder, mulberry32(5), 'vacancy');
    const b = botAction(state, responder, mulberry32(5), 'vacancy');
    expect(a).toEqual(b);
    expect(legalActions(state, responder)).toContainEqual(a);
  });

  it('mão de onze: o bot de vaga aceita jogar com mão razoável e corre só com mão péssima', () => {
    const jogar = (hand: Card[]) => {
      const s = startHandFromCards({
        variant: PAULISTA,
        pe: 3,
        scores: [11, 0],
        hands: [
          hand,
          [c('Q', 'ouros'), c('J', 'ouros'), c('K', 'ouros')],
          [c('A', 'ouros'), c('7', 'ouros'), c('6', 'ouros')],
          [c('4', 'espadas'), c('6', 'espadas'), c('7', 'espadas')],
        ],
        vira: c('4', 'ouros'),
      });
      expect(s.phase).toBe('specialDecision');
      return botAction(s, 0, undefined, 'vacancy');
    };
    expect(jogar([c('5', 'paus'), c('3', 'copas'), c('2', 'copas')])).toEqual({
      type: 'playSpecial',
      seat: 0,
    });
    expect(jogar([c('4', 'paus'), c('4', 'copas'), c('6', 'paus')])).toEqual({
      type: 'runSpecial',
      seat: 0,
    });
  });
});

/** Humano simulado: ação legal aleatória, com forte preferência por pedir e aumentar aposta. */
function humanAction(state: MatchState, seat: Seat, rng: Rng): HandAction {
  const legal = legalActions(state, seat);
  const bets = legal.filter((a) => a.type === 'callBet' || a.type === 'raiseBet');
  if (bets.length > 0 && rng() < 0.5) return bets[0] as HandAction;
  return legal[Math.floor(rng() * legal.length)] as HandAction;
}

describe('bots em partidas simuladas', () => {
  const combos: { variant: Variant; ironHand: boolean }[] = [
    { variant: PAULISTA, ironHand: true },
    { variant: PAULISTA, ironHand: false },
    { variant: MINEIRO, ironHand: true },
    { variant: MINEIRO, ironHand: false },
  ];
  const profiles: BotProfile[] = ['absence', 'vacancy'];

  for (const profile of profiles) {
    it(`1000 partidas com perfil ${profile}: nunca ação ilegal e o bot nunca pede nem aumenta aposta`, () => {
      let botAccepts = 0;
      let botRuns = 0;
      for (let g = 0; g < 1000; g++) {
        const { variant, ironHand } = combos[g % combos.length] as (typeof combos)[number];
        const rng = mulberry32(g * 7919 + 13);
        let state: MatchState = startMatch({ variant, ironHand, rng }).state;
        // assentos 1 e 3 são bots; 0 e 2 são humanos que apostam
        for (let steps = 0; state.winner === null; steps++) {
          if (steps > 5000) throw new Error('loop infinito');
          const seat = pendingSeat(state);
          if (seat === null) throw new Error('travado');
          const isBot = seat % 2 === 1;
          const action = isBot
            ? (botAction(state, seat, rng, profile) as HandAction)
            : humanAction(state, seat, rng);
          if (isBot) {
            expect(['callBet', 'raiseBet']).not.toContain(action.type);
            expect(legalActions(state, seat)).toContainEqual(action);
            if (action.type === 'acceptBet') botAccepts++;
            if (action.type === 'runBet') botRuns++;
          }
          const r = applyMatchAction(state, action, rng);
          if (!r.ok) throw new Error(`ação ilegal ${action.type}: ${r.error.code}`);
          state = r.state;
        }
      }
      expect(botAccepts + botRuns).toBeGreaterThan(0);
      if (profile === 'absence') expect(botAccepts).toBe(0);
      else {
        expect(botAccepts).toBeGreaterThan(0);
        expect(botRuns).toBeGreaterThan(0);
      }
    }, 120_000);
  }

  it('applyHandAction aceita a ação do bot de vaga em aposta pendente', () => {
    const { state, responder } = trucoContra(PAULISTA, FORTE);
    const a = botAction(state, responder, undefined, 'vacancy') as HandAction;
    expect(applyHandAction(state, a).ok).toBe(true);
  });
});
