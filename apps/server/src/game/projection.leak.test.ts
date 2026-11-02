import {
  mulberry32,
  legalActions,
  applySeriesAction,
  startHand,
  startSeries,
  variantById,
} from '@trucaco/rules';
import type { Card, HandAction, SeriesState, Seat, VariantId } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';
import { TruthLog, key, leakViolations } from './leakdetect';
import { projectState } from './projection';
import { PlayedCardSchema, createTableState } from './schema';
import type { SeatPrivateNode } from './schema';
import { WireSim } from './testkit';

/** JSON de cliente manipulável nos testes do detector. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SEATS = [0, 1, 2, 3] as const;
function checkClientView(json: unknown, series: SeriesState, seat: Seat, label: string): void {
  expect(leakViolations(json, series, seat, label)).toEqual([]);
}

interface Scenario {
  variant: VariantId;
  ironHand: boolean;
  format: 'single' | 'bo3';
  scores: readonly [number, number];
  seed: number;
}

function startScenario(sc: Scenario): { series: SeriesState; rng: () => number } {
  const rng = mulberry32(sc.seed);
  const variant = variantById(sc.variant);
  const s = startSeries({
    variant,
    config: { format: sc.format, ironHand: sc.ironHand },
    pe: 0,
    rng,
  });
  let series = s.state;
  if (sc.scores[0] !== 0 || sc.scores[1] !== 0) {
    const hand = startHand({ variant, pe: 0, scores: sc.scores, ironHand: sc.ironHand, rng });
    series = { ...series, match: { ...series.match, scores: sc.scores, hand } };
  }
  return { series, rng };
}

function pick(series: SeriesState, rng: () => number): HandAction {
  const actors = SEATS.filter((s) => legalActions(series, s).length > 0);
  const seat = actors[Math.floor(rng() * actors.length)] as Seat;
  const legal = legalActions(series, seat);
  // Prefere apostar/aceitar às vezes, para exercitar betPending e valores altos.
  const bets = legal.filter(
    (a) => a.type === 'callBet' || a.type === 'raiseBet' || a.type === 'acceptBet',
  );
  const covered = legal.filter((a) => a.type === 'playCard' && a.covered === true);
  const r = rng();
  if (bets.length > 0 && r < 0.3) return bets[Math.floor(rng() * bets.length)] as HandAction;
  if (covered.length > 0 && r < 0.55)
    return covered[Math.floor(rng() * covered.length)] as HandAction;
  return legal[Math.floor(rng() * legal.length)] as HandAction;
}

function simulate(sc: Scenario): { steps: number; saw: Set<string> } {
  const { series: initial, rng } = startScenario(sc);
  let series = initial;
  const state = createTableState('ABCD2345', {
    variant: sc.variant,
    format: sc.format,
    ironHand: sc.ironHand,
    visibility: 'private',
  });
  const sim = new WireSim(state);
  projectState(series, state);
  // Cada patch é conferido contra a versão da verdade que o gerou, e varre os refs do decoder.
  const log = new TruthLog();
  log.record(series, state.toJSON());
  const clients = SEATS.map((s) => sim.connect(s));
  const saw = new Set<string>();
  let steps = 0;
  const verify = (): void => {
    const h = series.match.hand;
    saw.add(h.special);
    saw.add(`phase:${h.phase}`);
    if (h.current.some((p) => p.covered) || h.tricks.some((t) => t.plays.some((p) => p.covered)))
      saw.add('covered');
    for (const c of clients) {
      expect(
        log.violations(
          sim.json(c),
          c.seat,
          `seed ${sc.seed} passo ${steps} assento ${c.seat} (long)`,
          { decoder: c.decoder },
        ),
      ).toEqual([]);
      checkClientView(
        sim.json(c),
        series,
        c.seat,
        `seed ${sc.seed} passo ${steps} assento ${c.seat} (long, série atual)`,
      );
      // Reconexão: view nova + estado completo a cada passo.
      checkClientView(
        sim.snapshotFor(c.seat),
        series,
        c.seat,
        `seed ${sc.seed} passo ${steps} assento ${c.seat} (reconexão)`,
      );
    }
  };
  sim.flush();
  verify();
  while (series.winner === null && steps < 600) {
    const action = pick(series, rng);
    const r = applySeriesAction(series, action, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) break;
    series = r.state;
    steps++;
    projectState(series, state, { turnDeadlineAt: 1000 + steps });
    log.record(series, state.toJSON());
    sim.flush();
    verify();
  }
  expect(series.winner).not.toBeNull();
  return { steps, saw };
}

describe('projeção: nenhum cliente recebe carta que não deve', () => {
  for (const variant of ['paulista', 'mineiro'] as const) {
    const t = variantById(variant).specialHandThreshold;
    const cases: {
      name: string;
      ironHand: boolean;
      format: 'single' | 'bo3';
      scores: [number, number];
    }[] = [
      { name: 'jogo normal', ironHand: true, format: 'single', scores: [0, 0] },
      { name: 'série bo3', ironHand: true, format: 'bo3', scores: [0, 0] },
      { name: 'mão de onze/dez (dupla 0)', ironHand: true, format: 'single', scores: [t, 0] },
      { name: 'mão de onze/dez (dupla 1)', ironHand: true, format: 'single', scores: [3, t] },
      { name: 'mão de ferro', ironHand: true, format: 'single', scores: [t, t] },
      { name: 'ambas no limiar sem ferro', ironHand: false, format: 'single', scores: [t, t] },
    ];
    for (const c of cases) {
      it(`${variant}: ${c.name}`, () => {
        const total = new Set<string>();
        for (const seed of [1, 2, 3, 4, 5]) {
          const { saw } = simulate({
            variant,
            ironHand: c.ironHand,
            format: c.format,
            scores: c.scores,
            seed,
          });
          saw.forEach((x) => total.add(x));
        }
        const ferro = c.scores[0] === t && c.scores[1] === t && c.ironHand;
        if (!ferro) expect(total.has('covered')).toBe(true);
        if (c.scores[0] === t && c.scores[1] === t && c.ironHand)
          expect(total.has('maoDeFerro')).toBe(true);
        if ((c.scores[0] === t) !== (c.scores[1] === t)) {
          expect(total.has('maoDeOnze')).toBe(true);
          expect(total.has('phase:specialDecision')).toBe(true);
        }
        if (c.scores[0] === 0) expect(total.has('phase:betPending')).toBe(true);
      });
    }
  }

  it('o detector pega vazamento: carta alheia no estado compartilhado ou bloco privado alheio', () => {
    const { series } = startScenario({
      variant: 'paulista',
      ironHand: true,
      format: 'single',
      scores: [0, 0],
      seed: 9,
    });
    const state = createTableState('ABCD2345', {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    });
    projectState(series, state);
    const sim = new WireSim(state);
    const c0 = sim.connect(0);
    sim.flush();
    checkClientView(sim.json(c0), series, 0, 'base');
    // 1) injeta a primeira carta do assento 1 no estado compartilhado
    const leaked = series.match.hand.hands[1]?.[0] as Card;
    const p = new PlayedCardSchema();
    p.seat = 1;
    p.rank = leaked.rank;
    p.suit = leaked.suit;
    state.hand.current.push(p);
    sim.flush();
    expect(() => checkClientView(sim.json(c0), series, 0, 'vazou')).toThrow();
    state.hand.current.pop();
    // 2) view do assento 0 enxergando também o bloco do assento 1
    c0.view.add(state.privates.get('1') as SeatPrivateNode);
    sim.flush();
    expect(() => checkClientView(sim.json(c0), series, 0, 'vazou')).toThrow();
  });

  it('Mineiro: manilhas fixas só são isentas em hand.manilhaCards; em qualquer outro campo são acusadas', () => {
    // Procura uma semente em que o assento 1 (adversário do 0) tenha uma manilha fixa na mão.
    let found: { series: SeriesState; card: Card } | undefined;
    for (let seed = 1; seed < 200 && found === undefined; seed++) {
      const { series } = startScenario({
        variant: 'mineiro',
        ironHand: false,
        format: 'single',
        scores: [0, 0],
        seed,
      });
      const fixed = series.match.hand.variant.fixedManilhas ?? [];
      const card = (series.match.hand.hands[1] ?? []).find((c) =>
        fixed.some((m) => key(m) === key(c)),
      );
      if (card !== undefined) found = { series, card };
    }
    expect(found).toBeDefined();
    const { series, card } = found as { series: SeriesState; card: Card };
    const state = createTableState('ABCD2345', {
      variant: 'mineiro',
      format: 'single',
      ironHand: false,
      visibility: 'private',
    });
    projectState(series, state);
    const sim = new WireSim(state);
    const c0 = sim.connect(0);
    sim.flush();
    const text = key(card);
    const clean = sim.json(c0) as Json;
    // (b) manilhaCards legítimo (tree e refs do decoder) não é acusado.
    expect((clean.hand as { manilhaCards: string[] }).manilhaCards).toContain(text);
    expect(leakViolations(clean, series, 0, 'ok', { decoder: c0.decoder })).toEqual([]);
    // (a) a mesma string em outros campos é acusada.
    const clone = (): Json => JSON.parse(JSON.stringify(clean));
    const injections: Array<[string, (j: Json) => void]> = [
      ['privates.hand', (j) => (j.privates['0'].hand = [...j.privates['0'].hand, text])],
      ['players', (j) => (j.players[1].nickname = text)],
      ['current', (j) => j.hand.current.push(text)],
      ['partnerCards', (j) => j.privates['0'].partnerCards.push(text)],
      ['manilhaCards fora do campo', (j) => (j.hand.tricks = [text])],
    ];
    for (const [name, inject] of injections) {
      const j = clone();
      inject(j);
      expect(leakViolations(j, series, 0, name), name).not.toEqual([]);
    }
  });

  it('mão de onze: partnerCards só para a dupla que decide, e some depois da decisão', () => {
    const { series, rng } = startScenario({
      variant: 'paulista',
      ironHand: true,
      format: 'single',
      scores: [11, 0],
      seed: 4,
    });
    const state = createTableState('ABCD2345', {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    });
    projectState(series, state);
    const hands = series.match.hand.hands;
    const priv = (seat: number): SeatPrivateNode =>
      state.privates.get(String(seat)) as SeatPrivateNode;
    const partner = (seat: number): string[] =>
      priv(seat)
        .partnerCards.map((c) => `${c.rank}${c.suit}`)
        .sort();
    expect(partner(0)).toEqual((hands[2] ?? []).map(key).sort());
    expect(partner(2)).toEqual((hands[0] ?? []).map(key).sort());
    expect(partner(1)).toEqual([]);
    expect(partner(3)).toEqual([]);
    expect(priv(0).legalActions.toJSON()).toEqual(['specialPlay', 'specialRun']);
    expect(priv(1).legalActions.toJSON()).toEqual([]);
    const r = applySeriesAction(series, { type: 'playSpecial', seat: 0 }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    projectState(r.state, state);
    for (const s of SEATS) expect(partner(s)).toEqual([]);
  });

  it('mão de ferro: dono sem cartas, só handSize; ações são playBlind:<i>', () => {
    const { series } = startScenario({
      variant: 'mineiro',
      ironHand: true,
      format: 'single',
      scores: [10, 10],
      seed: 4,
    });
    const state = createTableState('ABCD2345', {
      variant: 'mineiro',
      format: 'single',
      ironHand: true,
      visibility: 'private',
    });
    projectState(series, state);
    const turn = series.match.hand.turn;
    for (const s of SEATS) {
      const p = state.privates.get(String(s)) as SeatPrivateNode;
      expect(p.hand.length).toBe(0);
      expect(state.players[s]?.handSize).toBe(3);
      expect(p.legalActions.toJSON()).toEqual(
        s === turn ? ['playBlind:0', 'playBlind:1', 'playBlind:2'] : [],
      );
    }
  });
});
