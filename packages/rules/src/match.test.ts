import { describe, expect, it } from 'vitest';
import { botAction, legalActions, MINEIRO, PAULISTA, mulberry32, pendingSeat } from './index';
import type { GameEvent, HandAction, MatchState, Rng, Variant } from './index';
import { applyMatchAction, startMatch } from './match';
import { publicEvent } from './events';

/** Joga o jogo todo com bots; devolve estado final e todos os eventos. */
export function playMatchWithBots(variant: Variant, seed: number, seats = 4) {
  const rng = mulberry32(seed);
  const start = startMatch({ variant, seats, rng });
  let state: MatchState = start.state;
  const events: GameEvent[] = [...start.events];
  for (let steps = 0; steps < 5000; steps++) {
    if (state.winner !== null) return { state, events, steps };
    const seat = pendingSeat(state);
    if (seat === null) throw new Error('travado');
    const action = botAction(state, seat, rng) as HandAction;
    const r = applyMatchAction(state, action, rng);
    if (!r.ok) throw new Error(`ação ilegal ${action.type}: ${r.error.code}`);
    state = r.state;
    events.push(...r.events);
  }
  throw new Error('loop infinito');
}

describe('partida', () => {
  it('mesma seed dá o mesmo resultado', () => {
    const a = playMatchWithBots(PAULISTA, 42);
    const b = playMatchWithBots(PAULISTA, 42);
    expect(b.events).toEqual(a.events);
    expect(b.state.scores).toEqual(a.state.scores);
  });

  it('o pé gira um assento a cada mão', () => {
    const { events } = playMatchWithBots(PAULISTA, 7);
    const pes = events.flatMap((e) => (e.type === 'handStarted' ? [e.pe] : []));
    expect(pes.length).toBeGreaterThan(2);
    pes.forEach((pe, i) => expect(pe).toBe(i % 4));
  });

  it('termina com a dupla vencedora em 12 pontos, sem passar de 12', () => {
    for (const v of [PAULISTA, MINEIRO]) {
      const { state } = playMatchWithBots(v, 3);
      expect(state.winner).not.toBeNull();
      expect(Math.max(...state.scores)).toBe(12);
    }
  });

  it('nova mão abre com o placar certo e mão de onze', () => {
    const rng = mulberry32(1);
    const { state } = startMatch({ variant: PAULISTA, rng });
    // dupla 0 com 10; ganha 1 ponto (a dupla 1 corre de aposta) e chega a 11
    const m: MatchState = {
      ...state,
      scores: [10, 0],
      hand: { ...state.hand, scores: [10, 0] },
    };
    const seat = m.hand.turn;
    const t0 = seat % 2;
    const caller = t0 === 0 ? seat : (seat + 1) % 4;
    // faz a dupla 0 pedir truco no turno do seu assento: avança com bot até ser a vez da dupla 0
    let cur = m;
    while (cur.hand.turn % 2 !== 0) {
      const a = botAction(cur, cur.hand.turn) as HandAction;
      const r = applyMatchAction(cur, a, rng);
      if (!r.ok) throw new Error('x');
      cur = r.state;
    }
    void caller;
    const call = applyMatchAction(cur, { type: 'callBet', seat: cur.hand.turn }, rng);
    if (!call.ok) throw new Error('call');
    const run = applyMatchAction(call.state, { type: 'runBet', seat: 1 }, rng);
    if (!run.ok) throw new Error('run');
    expect(run.state.scores).toEqual([11, 0]);
    expect(run.state.hand.special).toBe('maoDeOnze');
    expect(run.state.hand.phase).toBe('specialDecision');
    expect(run.state.handNumber).toBe(2);
    expect(run.state.pe).toBe(1);
    expect(run.events.map((e) => e.type)).toEqual(['betRun', 'handDecided', 'handStarted']);
  });

  it('jogo encerrado rejeita ações', () => {
    const { state } = playMatchWithBots(PAULISTA, 5);
    const r = applyMatchAction(state, { type: 'callBet', seat: 0 }, mulberry32(1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('GAME_FINISHED');
  });

  it('uma mão curta emite a sequência esperada de eventos', () => {
    const rng = mulberry32(11);
    let { state } = startMatch({ variant: PAULISTA, rng });
    const all: GameEvent[] = [];
    // 4 bots jogam até a primeira mão decidir
    for (;;) {
      const seat = pendingSeat(state) as number;
      const r = applyMatchAction(state, botAction(state, seat, rng) as HandAction, rng);
      if (!r.ok) throw new Error('x');
      state = r.state;
      all.push(...r.events);
      if (all.some((e) => e.type === 'handDecided')) break;
    }
    const types = all.map((e) => e.type);
    const cards = types.filter((t) => t === 'cardPlayed').length;
    expect(cards === 8 || cards === 12).toBe(true);
    expect(types.filter((t) => t === 'trickDecided')).toHaveLength(cards / 4);
    expect(types.slice(-2)).toEqual(['handDecided', 'handStarted']);
    // cada vaza fecha logo após a 4ª carta
    const firstTrick = types.indexOf('trickDecided');
    expect(types.slice(0, firstTrick)).toEqual([
      'cardPlayed',
      'cardPlayed',
      'cardPlayed',
      'cardPlayed',
    ]);
  });

  it('apostas e decisões geram os eventos correspondentes', () => {
    const rng = mulberry32(2);
    const { state } = startMatch({ variant: PAULISTA, rng });
    const t = state.hand.turn;
    const a = applyMatchAction(state, { type: 'callBet', seat: t }, rng);
    if (!a.ok) throw new Error('a');
    expect(a.events).toEqual([{ type: 'betCalled', seat: t, toLevel: 0, value: 3 }]);
    const b = applyMatchAction(a.state, { type: 'raiseBet', seat: (t + 1) % 4 }, rng);
    if (!b.ok) throw new Error('b');
    expect(b.events).toEqual([{ type: 'betRaised', seat: (t + 1) % 4, toLevel: 1, value: 6 }]);
    const c = applyMatchAction(b.state, { type: 'acceptBet', seat: t }, rng);
    if (!c.ok) throw new Error('c');
    expect(c.events).toEqual([{ type: 'betAccepted', seat: t, value: 6 }]);
  });
});

describe('publicEvent', () => {
  const card = { rank: '3', suit: 'paus' } as const;
  it('esconde carta coberta de outros, mostra ao dono', () => {
    const e: GameEvent = { type: 'cardPlayed', seat: 1, card, covered: true, blind: false };
    expect(publicEvent(e)).toMatchObject({ card: null });
    expect(publicEvent(e, 0)).toMatchObject({ card: null });
    expect(publicEvent(e, 1)).toMatchObject({ card });
  });
  it('carta jogada às cegas (mão de ferro) fica visível a toda a mesa', () => {
    const e: GameEvent = { type: 'cardPlayed', seat: 1, card, covered: false, blind: true };
    expect(publicEvent(e)).toMatchObject({ card });
    expect(publicEvent(e, 0)).toMatchObject({ card });
    expect(publicEvent(e, 1)).toMatchObject({ card });
  });
  it('carta aberta passa intacta', () => {
    const e: GameEvent = { type: 'cardPlayed', seat: 1, card, covered: false, blind: false };
    expect(publicEvent(e)).toEqual(e);
  });
});

describe('legalActions e bot', () => {
  const key = (a: HandAction) =>
    JSON.stringify([
      a.type,
      a.seat,
      'card' in a ? a.card : null,
      'covered' in a ? a.covered === true : false,
      'index' in a ? a.index : null,
    ]);

  function candidates(state: MatchState): HandAction[] {
    const out: HandAction[] = [];
    const foreign = { rank: '4', suit: 'copas' } as const;
    for (let seat = 0; seat < state.seats; seat++) {
      const cards = [...state.hand.hands.flat(), foreign];
      for (const card of cards) {
        out.push({ type: 'playCard', seat, card }, { type: 'playCard', seat, card, covered: true });
      }
      for (let index = -1; index < 4; index++) out.push({ type: 'playBlindCard', seat, index });
      for (const type of [
        'callBet',
        'acceptBet',
        'raiseBet',
        'runBet',
        'playSpecial',
        'runSpecial',
      ] as const)
        out.push({ type, seat });
    }
    return out;
  }

  it('lista == ações aceitas, em partidas com ações aleatórias', () => {
    for (const variant of [PAULISTA, MINEIRO]) {
      for (let seed = 1; seed <= 12; seed++) {
        const rng: Rng = mulberry32(seed);
        let { state } = startMatch({ variant, rng });
        for (let step = 0; step < 3000 && state.winner === null; step++) {
          const accepted = new Set<string>();
          for (const c of candidates(state)) {
            if (applyMatchAction(state, c, mulberry32(1)).ok) accepted.add(key(c));
          }
          const listed = new Set<string>();
          for (let s = 0; s < state.seats; s++)
            legalActions(state, s).forEach((a) => listed.add(key(a)));
          expect(listed).toEqual(accepted);
          const seats = [...Array(state.seats).keys()].filter(
            (s) => legalActions(state, s).length > 0,
          );
          const seat = seats[Math.floor(rng() * seats.length)] as number;
          const acts = legalActions(state, seat);
          const act = acts[Math.floor(rng() * acts.length)] as HandAction;
          const r = applyMatchAction(state, act, rng);
          if (!r.ok) throw new Error('ilegal');
          state = r.state;
        }
        expect(state.winner).not.toBeNull();
      }
    }
  }, 60000);

  it('coberta só a partir da 2ª vaza', () => {
    const { state } = startMatch({ variant: PAULISTA, rng: mulberry32(9) });
    const acts = legalActions(state, state.hand.turn);
    expect(acts.some((a) => a.type === 'playCard' && a.covered === true)).toBe(false);
    expect(legalActions(state, (state.hand.turn + 1) % 4)).toEqual([]);
  });

  it('1000 partidas de bots terminam sem ação ilegal', () => {
    let finished = 0;
    for (let seed = 0; seed < 1000; seed++) {
      const v = seed % 2 === 0 ? PAULISTA : MINEIRO;
      const { state, steps } = playMatchWithBots(v, seed + 1000);
      expect(steps).toBeLessThan(5000);
      if (state.winner !== null) finished++;
    }
    expect(finished).toBe(1000);
  }, 120000);
});
