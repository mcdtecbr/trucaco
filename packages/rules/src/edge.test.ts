import { describe, expect, it } from 'vitest';
import {
  applyHandAction,
  applyMatchAction,
  applySeriesAction,
  botAction,
  legalActions,
  MINEIRO,
  mulberry32,
  PAULISTA,
  pendingSeat,
  publicEvent,
  startHand,
  startMatch,
  startSeries,
  viewFor,
} from './index';
import type {
  Card,
  GameEvent,
  HandAction,
  HandState,
  MatchState,
  Rng,
  RuleErrorCode,
  SeriesState,
  Variant,
} from './index';
import { handFromTricks, must, playFirstCards } from './testing';

function deepFreeze<T>(o: T): T {
  if (o !== null && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

function codeOf(r: { ok: boolean; error?: { code: RuleErrorCode } }): RuleErrorCode | 'OK' {
  return r.ok ? 'OK' : (r.error?.code as RuleErrorCode);
}

/** Escolhe uma ação legal (inclui apostas) com o rng; para variar os caminhos da partida. */
function randomAction(state: MatchState | SeriesState, rng: Rng): HandAction {
  const seat = pendingSeat(state);
  if (seat === null) throw new Error('travado');
  const legal = legalActions(state, seat);
  return legal[Math.floor(rng() * legal.length)] as HandAction;
}

function playSeriesToGameEnd(variant: Variant, ironHand: boolean, seed: number) {
  const rng = mulberry32(seed);
  const start = startSeries({ variant, config: { format: 'bo3', ironHand }, rng });
  let state = start.state;
  const events: GameEvent[] = [...start.events];
  let lastPe = state.match.pe;
  for (let i = 0; i < 5000 && state.gameNumber === 1; i++) {
    lastPe = state.match.hand.pe;
    const seat = pendingSeat(state) as number;
    const r = applySeriesAction(state, botAction(state, seat, rng) as HandAction, rng);
    if (!r.ok) throw new Error(r.error.code);
    state = r.state;
    events.push(...r.events);
  }
  return { state, events, lastPe, rng };
}

describe('bo3: jogo 1 inteiro até o jogo 2 começar', () => {
  describe.each([
    ['paulista', PAULISTA],
    ['mineiro', MINEIRO],
  ] as const)('%s', (_n, variant) => {
    it.each([true, false])(
      'com ironHand:%s a opção, a variante e as 4 cadeiras propagam; placar reinicia; pé segue o rodízio',
      (ironHand) => {
        const { state, events, lastPe } = playSeriesToGameEnd(variant, ironHand, 11);
        expect(state.gameNumber).toBe(2);
        expect(state.games[0] + state.games[1]).toBe(1);
        expect(state.history).toHaveLength(1);
        expect(state.winner).toBeNull();
        expect(state.match.ironHand).toBe(ironHand);
        expect(state.match.variant.id).toBe(variant.id);
        expect(state.match.hand.variant.id).toBe(variant.id);
        expect(state.match.seats).toBe(4);
        expect(state.match.scores).toEqual([0, 0]);
        expect(state.match.handNumber).toBe(1);
        expect(state.match.winner).toBeNull();
        expect(state.match.pe).toBe((lastPe + 1) % 4);
        expect(state.match.hand.pe).toBe((lastPe + 1) % 4);
        expect(state.match.hand.special).toBe('normal');
        expect(events.filter((e) => e.type === 'gameDecided')).toHaveLength(1);
        expect(events.filter((e) => e.type === 'gameStarted')).toHaveLength(2);
        expect(events.filter((e) => e.type === 'seriesDecided')).toHaveLength(0);
      },
    );

    it.each([true, false])(
      'o jogo 2 com ironHand:%s é jogável até o fim sem ação ilegal',
      (ironHand) => {
        const { state: s0, rng } = playSeriesToGameEnd(variant, ironHand, 12);
        let state = s0;
        for (let i = 0; i < 5000 && state.gameNumber === 2 && state.winner === null; i++) {
          const seat = pendingSeat(state) as number;
          const r = applySeriesAction(state, botAction(state, seat, rng) as HandAction, rng);
          if (!r.ok) throw new Error(r.error.code);
          state = r.state;
        }
        expect(state.gameNumber === 3 || state.winner !== null).toBe(true);
      },
    );
  });
});

describe('ações ilegais devolvem código tipado', () => {
  const s0 = handFromTricks(PAULISTA, [
    ['3', '2', 'A', 'K'],
    ['J', 'Q', '7', '6'],
    ['K', '4', '4', '4'],
  ]);
  const card0 = s0.hands[0]?.[0] as Card;
  const card1 = s0.hands[1]?.[0] as Card;

  it('jogar fora do turno: NOT_YOUR_TURN', () => {
    expect(codeOf(applyHandAction(s0, { type: 'playCard', seat: 1, card: card1 }))).toBe(
      'NOT_YOUR_TURN',
    );
  });

  it('pedir truco fora do turno: NOT_YOUR_TURN', () => {
    expect(codeOf(applyHandAction(s0, { type: 'callBet', seat: 2 }))).toBe('NOT_YOUR_TURN');
  });

  it('carta que não está na mão: CARD_NOT_IN_HAND', () => {
    const r = applyHandAction(s0, {
      type: 'playCard',
      seat: 0,
      card: { rank: '5', suit: 'paus' },
    });
    expect(codeOf(r)).toBe('CARD_NOT_IN_HAND');
    expect(codeOf(applyHandAction(s0, { type: 'playCard', seat: 0, card: card1 }))).toBe(
      'CARD_NOT_IN_HAND',
    );
  });

  it('cobrir na 1ª vaza: COVERED_NOT_ALLOWED', () => {
    const r = applyHandAction(s0, { type: 'playCard', seat: 0, card: card0, covered: true });
    expect(codeOf(r)).toBe('COVERED_NOT_ALLOWED');
  });

  it('assento inexistente: INVALID_SEAT', () => {
    for (const seat of [-1, 4, 1.5, NaN]) {
      expect(codeOf(applyHandAction(s0, { type: 'callBet', seat }))).toBe('INVALID_SEAT');
    }
  });

  it('jogar às cegas fora da mão de ferro: NOT_BLIND_HAND', () => {
    expect(codeOf(applyHandAction(s0, { type: 'playBlindCard', seat: 0, index: 0 }))).toBe(
      'NOT_BLIND_HAND',
    );
  });

  it('responder aposta que não existe: NO_PENDING_BET; decidir onze que não existe: NO_SPECIAL_DECISION', () => {
    expect(codeOf(applyHandAction(s0, { type: 'acceptBet', seat: 1 }))).toBe('NO_PENDING_BET');
    expect(codeOf(applyHandAction(s0, { type: 'playSpecial', seat: 0 }))).toBe(
      'NO_SPECIAL_DECISION',
    );
  });

  it('jogar carta com aposta pendente: BET_PENDING', () => {
    const s = must(s0, { type: 'callBet', seat: 0 });
    expect(codeOf(applyHandAction(s, { type: 'playCard', seat: 0, card: card0 }))).toBe(
      'BET_PENDING',
    );
  });

  it('o próprio pedinte responder à sua aposta: NOT_YOUR_TURN', () => {
    const s = must(s0, { type: 'callBet', seat: 0 });
    expect(codeOf(applyHandAction(s, { type: 'acceptBet', seat: 2 }))).toBe('NOT_YOUR_TURN');
  });

  it('mão de ferro: truco é BET_NOT_ALLOWED e carta aberta é BLIND_ONLY', () => {
    const h = startHand({ variant: PAULISTA, pe: 0, scores: [11, 11], rng: mulberry32(1) });
    expect(h.special).toBe('maoDeFerro');
    expect(codeOf(applyHandAction(h, { type: 'callBet', seat: h.turn }))).toBe('BET_NOT_ALLOWED');
    const card = h.hands[h.turn]?.[0] as Card;
    expect(codeOf(applyHandAction(h, { type: 'playCard', seat: h.turn, card }))).toBe('BLIND_ONLY');
    expect(codeOf(applyHandAction(h, { type: 'playBlindCard', seat: h.turn, index: 3 }))).toBe(
      'CARD_NOT_IN_HAND',
    );
    expect(codeOf(applyHandAction(h, { type: 'playBlindCard', seat: h.turn, index: -1 }))).toBe(
      'CARD_NOT_IN_HAND',
    );
  });

  it('mão de onze: jogar carta antes de decidir é SPECIAL_DECISION_PENDING; dupla errada decide: NOT_YOUR_TURN', () => {
    const h = startHand({ variant: PAULISTA, pe: 0, scores: [11, 3], rng: mulberry32(2) });
    expect(h.phase).toBe('specialDecision');
    const card = h.hands[h.turn]?.[0] as Card;
    expect(codeOf(applyHandAction(h, { type: 'playCard', seat: h.turn, card }))).toBe(
      'SPECIAL_DECISION_PENDING',
    );
    expect(codeOf(applyHandAction(h, { type: 'callBet', seat: h.turn }))).toBe(
      'SPECIAL_DECISION_PENDING',
    );
    expect(codeOf(applyHandAction(h, { type: 'playSpecial', seat: 1 }))).toBe('NOT_YOUR_TURN');
  });

  it('aumentar sendo o último a aumentar: BET_NOT_ALLOWED', () => {
    let s = must(s0, { type: 'callBet', seat: 0 });
    s = must(s, { type: 'acceptBet', seat: 1 });
    expect(codeOf(applyHandAction(s, { type: 'callBet', seat: 0 }))).toBe('BET_NOT_ALLOWED');
    expect(legalActions(s, 0).some((a) => a.type === 'callBet')).toBe(false);
  });

  it('mão encerrada: HAND_FINISHED', () => {
    let s = must(s0, { type: 'callBet', seat: 0 });
    s = must(s, { type: 'runBet', seat: 1 });
    expect(s.phase).toBe('finished');
    expect(codeOf(applyHandAction(s, { type: 'callBet', seat: 0 }))).toBe('HAND_FINISHED');
    expect(legalActions(s, 0)).toEqual([]);
  });

  it('jogo e série finalizados: GAME_FINISHED e SERIES_FINISHED', () => {
    const rng = mulberry32(21);
    let m = startMatch({ variant: PAULISTA, rng }).state;
    for (let i = 0; i < 5000 && m.winner === null; i++) {
      const r = applyMatchAction(m, botAction(m, pendingSeat(m) as number, rng) as HandAction, rng);
      if (!r.ok) throw new Error(r.error.code);
      m = r.state;
    }
    expect(m.winner).not.toBeNull();
    for (const action of [
      { type: 'callBet', seat: 0 },
      { type: 'acceptBet', seat: 1 },
      { type: 'playSpecial', seat: 0 },
    ] as const) {
      expect(codeOf(applyMatchAction(m, action, rng))).toBe('GAME_FINISHED');
    }
    expect(legalActions(m, 0)).toEqual([]);

    let s = startSeries({ variant: PAULISTA, config: { format: 'single' }, rng }).state;
    for (let i = 0; i < 5000 && s.winner === null; i++) {
      const r = applySeriesAction(
        s,
        botAction(s, pendingSeat(s) as number, rng) as HandAction,
        rng,
      );
      if (!r.ok) throw new Error(r.error.code);
      s = r.state;
    }
    expect(s.winner).not.toBeNull();
    expect(codeOf(applySeriesAction(s, { type: 'callBet', seat: 0 }, rng))).toBe('SERIES_FINISHED');
    expect(legalActions(s, 0)).toEqual([]);
  });
});

describe('limites de placar e escada', () => {
  it('placar nunca passa de 12 mesmo quando a mão vale mais', () => {
    const rng = mulberry32(1);
    const hand = handFromTricks(
      PAULISTA,
      [
        ['3', '2', 'A', 'K'],
        ['J', 'Q', '7', '6'],
        ['K', '4', '4', '4'],
      ],
      { scores: [10, 0] },
    );
    const m0 = startMatch({ variant: PAULISTA, rng }).state;
    let m: MatchState = { ...m0, scores: [10, 0], hand };
    for (const a of [
      { type: 'callBet', seat: 0 },
      { type: 'acceptBet', seat: 1 },
    ] as const) {
      const r = applyMatchAction(m, a, rng);
      if (!r.ok) throw new Error(r.error.code);
      m = r.state;
    }
    let events: readonly GameEvent[] = [];
    for (let i = 0; i < 8; i++) {
      const seat = m.hand.turn;
      const r = applyMatchAction(
        m,
        { type: 'playCard', seat, card: m.hand.hands[seat]?.[0] as Card },
        rng,
      );
      if (!r.ok) throw new Error(r.error.code);
      m = r.state;
      events = r.events;
    }
    expect(m.winner).toBe(0);
    expect(m.scores).toEqual([12, 0]);
    expect(events.find((e) => e.type === 'handDecided')).toMatchObject({
      points: 3,
      scores: [12, 0],
    });
  });

  it('em 200 jogos de ações aleatórias o placar nunca passa de 12 e o vencedor tem 12', () => {
    for (let seed = 0; seed < 200; seed++) {
      const variant = seed % 2 === 0 ? PAULISTA : MINEIRO;
      const rng = mulberry32(seed);
      let m = startMatch({ variant, rng }).state;
      for (let i = 0; i < 5000 && m.winner === null; i++) {
        const r = applyMatchAction(m, randomAction(m, rng), rng);
        if (!r.ok) throw new Error(r.error.code);
        m = r.state;
        expect(Math.max(...m.scores)).toBeLessThanOrEqual(12);
      }
      expect(m.winner).not.toBeNull();
      expect(m.scores[m.winner as 0 | 1]).toBe(12);
    }
  });

  describe.each([
    ['paulista', PAULISTA],
    ['mineiro', MINEIRO],
  ] as const)('corrida no topo da escada (%s)', (_n, variant) => {
    const top = variant.betLadder.length - 1;
    const base = handFromTricks(variant, [
      ['3', '2', 'A', 'K'],
      ['J', 'Q', '7', '6'],
      ['K', '4', '4', '4'],
    ]);
    // sobe até o topo: dupla 0 (assento 0) pede, dupla 1 (assento 1) aumenta, alternando.
    function climb(): HandState {
      let s = must(base, { type: 'callBet', seat: 0 });
      let responder = 1;
      for (let level = 0; level < top; level++) {
        s = must(s, { type: 'raiseBet', seat: responder });
        responder = 1 - responder;
      }
      return s;
    }

    it('no valor máximo pendente não existe raiseBet; aceitar fixa o topo e trava novos pedidos', () => {
      const s = climb();
      expect(s.pending?.toLevel).toBe(top);
      const responder = s.pending?.fromTeam === 0 ? 1 : 0;
      expect(codeOf(applyHandAction(s, { type: 'raiseBet', seat: responder }))).toBe(
        'BET_NOT_ALLOWED',
      );
      expect(legalActions(s, responder).map((a) => a.type)).toEqual(['acceptBet', 'runBet']);
      const acc = must(s, { type: 'acceptBet', seat: responder });
      expect(acc.value).toBe(12);
      for (let seat = 0; seat < 4; seat++)
        expect(legalActions(acc, seat).some((a) => a.type === 'callBet')).toBe(false);
    });

    it('correr no topo paga à dupla que pediu o degrau anterior (aceito ao aumentar), não o pedido', () => {
      const s = climb();
      const responder = s.pending?.fromTeam === 0 ? 1 : 0;
      const r = must(s, { type: 'runBet', seat: responder });
      expect(r.result).toEqual({
        winnerTeam: s.pending?.fromTeam,
        points: variant.betLadder[top - 1],
        reason: 'betRun',
      });
    });
  });
});

describe('mão de onze/dez e limiar', () => {
  const hand = (v: Variant, scores: [number, number]) =>
    startHand({ variant: v, pe: 0, scores, rng: mulberry32(9) });

  it('Mineiro com 11 pontos NÃO é mão especial (limiar é 10)', () => {
    for (const scores of [
      [11, 0],
      [0, 11],
      [11, 11],
      [11, 9],
    ] as const) {
      const h = hand(MINEIRO, [...scores]);
      expect(h.special).toBe('normal');
      expect(h.phase).toBe('playing');
      expect(h.betsLocked).toBe(false);
      expect(h.specialTeam).toBeNull();
    }
  });

  it('Mineiro 10x11 e 11x10: só a dupla com 10 está na mão de dez', () => {
    expect(hand(MINEIRO, [10, 11]).specialTeam).toBe(0);
    expect(hand(MINEIRO, [11, 10]).specialTeam).toBe(1);
    expect(hand(MINEIRO, [10, 11]).special).toBe('maoDeOnze');
  });

  it('Paulista 11x10 e 10x11: a dupla com 11 decide (mão de onze), a de 10 não', () => {
    const a = hand(PAULISTA, [11, 10]);
    const b = hand(PAULISTA, [10, 11]);
    expect([a.special, a.specialTeam, a.phase]).toEqual(['maoDeOnze', 0, 'specialDecision']);
    expect([b.special, b.specialTeam, b.phase]).toEqual(['maoDeOnze', 1, 'specialDecision']);
  });

  it('Paulista 10x10 é mão normal', () => {
    expect(hand(PAULISTA, [10, 10]).special).toBe('normal');
  });

  it('Mineiro 10x10 é mão de ferro; Paulista 11x11 é mão de ferro', () => {
    expect(hand(MINEIRO, [10, 10]).special).toBe('maoDeFerro');
    expect(hand(PAULISTA, [11, 11]).special).toBe('maoDeFerro');
  });
});

describe('imutabilidade', () => {
  it('estados congelados: nenhuma ação (legal ou ilegal) altera o estado anterior', () => {
    for (let seed = 0; seed < 40; seed++) {
      const variant = seed % 2 === 0 ? PAULISTA : MINEIRO;
      const rng = mulberry32(seed + 100);
      let s: SeriesState = deepFreeze(
        startSeries({ variant, config: { format: 'bo3' }, rng }).state,
      );
      for (let i = 0; i < 3000 && s.winner === null; i++) {
        const before = JSON.stringify(s);
        // ação ilegal também não pode mudar nada
        applySeriesAction(s, { type: 'acceptBet', seat: 0 }, rng);
        applySeriesAction(s, { type: 'playSpecial', seat: 3 }, rng);
        expect(JSON.stringify(s)).toBe(before);
        const r = applySeriesAction(s, randomAction(s, rng), rng);
        if (!r.ok) throw new Error(r.error.code);
        expect(JSON.stringify(s)).toBe(before);
        s = deepFreeze(r.state);
        deepFreeze(r.events);
      }
    }
  });

  it('applyHandAction não muta a mão congelada nem a lista de mãos', () => {
    const h = deepFreeze(startHand({ variant: MINEIRO, pe: 2, rng: mulberry32(3) }));
    const r = applyHandAction(h, {
      type: 'playCard',
      seat: h.turn,
      card: h.hands[h.turn]?.[0] as Card,
    });
    expect(r.ok).toBe(true);
    expect(h.hands[h.turn]).toHaveLength(3);
    expect(h.current).toHaveLength(0);
  });
});

describe('determinismo', () => {
  function record(variant: Variant, seed: number) {
    const rng = mulberry32(seed);
    const start = startSeries({ variant, config: { format: 'bo3' }, rng });
    let s = start.state;
    const events: GameEvent[] = [...start.events];
    for (let i = 0; i < 5000 && s.winner === null; i++) {
      const r = applySeriesAction(s, randomAction(s, rng), rng);
      if (!r.ok) throw new Error(r.error.code);
      s = r.state;
      events.push(...r.events);
    }
    return { s, events };
  }

  it.each([PAULISTA, MINEIRO])(
    'mesma seed dá exatamente a mesma sequência de eventos e o mesmo estado final (%s)',
    (variant) => {
      const a = record(variant, 77);
      const b = record(variant, 77);
      expect(a.events.length).toBeGreaterThan(20);
      expect(b.events).toEqual(a.events);
      expect(b.s).toEqual(a.s);
    },
  );

  it('seeds diferentes dão partidas diferentes', () => {
    expect(record(PAULISTA, 1).events).not.toEqual(record(PAULISTA, 2).events);
  });
});

describe('visão por assento e eventos públicos', () => {
  const key = (c: Card) => JSON.stringify(c);

  it('em partidas aleatórias, nenhuma visão contém carta alheia não revelada', () => {
    for (let seed = 0; seed < 30; seed++) {
      const variant = seed % 2 === 0 ? PAULISTA : MINEIRO;
      const rng = mulberry32(seed + 500);
      let m = startMatch({ variant, rng }).state;
      for (let i = 0; i < 3000 && m.winner === null; i++) {
        const h = m.hand;
        for (let viewer = 0; viewer < 4; viewer++) {
          const json = JSON.stringify(viewFor(h, viewer));
          const partnerSees = h.phase === 'specialDecision' && viewer % 2 === h.specialTeam;
          h.hands.forEach((cards, owner) => {
            if (owner === viewer || (partnerSees && owner % 2 === viewer % 2)) return;
            for (const c of cards) expect(json).not.toContain(key(c));
          });
          const covered = [...h.current, ...h.tricks.flatMap((t) => t.plays)].filter(
            (p) => p.covered && p.seat !== viewer,
          );
          for (const p of covered) expect(json).not.toContain(key(p.card));
        }
        const r = applyMatchAction(m, randomAction(m, rng), rng);
        if (!r.ok) throw new Error(r.error.code);
        m = r.state;
      }
    }
  });

  it('carta coberta: só o dono vê, também depois de a vaza fechar', () => {
    let s = handFromTricks(PAULISTA, [
      ['3', '2', 'A', 'K'],
      ['J', 'Q', '7', '6'],
      ['K', '4', '4', '4'],
    ]);
    s = playFirstCards(s, 4);
    const coverer = s.turn;
    const card = s.hands[coverer]?.[0] as Card;
    s = must(s, { type: 'playCard', seat: coverer, card, covered: true });
    s = playFirstCards(s, 3);
    const trick = (v: number) => viewFor(s, v).tricks[1]?.plays.find((p) => p.seat === coverer);
    expect(trick(coverer)).toMatchObject({ covered: true, card });
    for (const other of [0, 1, 2, 3].filter((x) => x !== coverer))
      expect(trick(other)).toMatchObject({ covered: true, card: null });
  });

  it('mão de ferro: ownHand é null para todos; carta às cegas jogada fica visível a toda a mesa', () => {
    const rng = mulberry32(31);
    const m0 = startMatch({ variant: PAULISTA, rng }).state;
    const hand = startHand({ variant: PAULISTA, pe: 0, scores: [11, 11], rng });
    const m: MatchState = { ...m0, scores: [11, 11], hand };
    for (let v = 0; v < 4; v++) {
      const view = viewFor(hand, v);
      expect(view.ownHand).toBeNull();
      expect(view.handSizes).toEqual([3, 3, 3, 3]);
      expect(JSON.stringify(view)).not.toContain(key(hand.hands[(v + 1) % 4]?.[0] as Card));
    }
    const seat = hand.turn;
    const expected = hand.hands[seat]?.[1] as Card;
    const r = applyMatchAction(m, { type: 'playBlindCard', seat, index: 1 }, rng);
    if (!r.ok) throw new Error(r.error.code);
    const ev = r.events.find((e) => e.type === 'cardPlayed');
    expect(ev).toMatchObject({ blind: true, covered: false, card: expected });
    for (let v = 0; v < 4; v++) {
      expect(publicEvent(ev as GameEvent, v)).toMatchObject({ card: expected, blind: true });
      expect(viewFor(r.state.hand, v).current[0]).toEqual({ seat, card: expected, covered: false });
    }
  });

  it('publicEvent: carta coberta só aparece para o dono; os demais veem card null', () => {
    const ev: GameEvent = {
      type: 'cardPlayed',
      seat: 2,
      card: { rank: '3', suit: 'copas' },
      covered: true,
      blind: false,
    };
    expect(publicEvent(ev, 2)).toMatchObject({ card: { rank: '3', suit: 'copas' } });
    expect(publicEvent(ev, 0)).toMatchObject({ card: null, covered: true });
    expect(publicEvent(ev)).toMatchObject({ card: null });
  });

  it('mão de onze: só a dupla que decide vê as cartas do parceiro', () => {
    const h = startHand({ variant: PAULISTA, pe: 0, scores: [11, 2], rng: mulberry32(8) });
    expect(viewFor(h, 0).partnerHands).toEqual({ 2: h.hands[2] });
    expect(viewFor(h, 2).partnerHands).toEqual({ 0: h.hands[0] });
    expect(viewFor(h, 1).partnerHands).toEqual({});
    expect(viewFor(h, 3).partnerHands).toEqual({});
  });
});
