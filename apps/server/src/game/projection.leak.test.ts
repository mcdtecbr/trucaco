import {
  mulberry32,
  legalActions,
  applySeriesAction,
  startHand,
  startSeries,
  teamOf,
  variantById,
} from '@trucaco/rules';
import type { Card, HandAction, SeriesState, Seat, VariantId } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';
import { legalActionIds, projectState } from './projection';
import { PlayedCardSchema, createTableState } from './schema';
import type { SeatPrivateNode } from './schema';
import { WireSim } from './testkit';

const SEATS = [0, 1, 2, 3] as const;
const key = (c: Card): string => `${c.rank}${c.suit}`;

/** Varre o JSON decodificado e junta todo objeto com cara de carta (rank e suit preenchidos). */
function sightings(node: unknown, path: string, out: { path: string; card: Card }[]): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => sightings(n, `${path}[${i}]`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if (typeof o.rank === 'string' && typeof o.suit === 'string' && o.rank !== '' && o.suit !== '') {
    out.push({ path, card: { rank: o.rank as Card['rank'], suit: o.suit as Card['suit'] } });
  }
  for (const [k, v] of Object.entries(o)) sightings(v, `${path}.${k}`, out);
}

/** Cartas citadas em ids de ação (`play:3paus`, `playCovered:Kouros`). */
function idCards(ids: readonly string[]): Card[] {
  const out: Card[] = [];
  for (const id of ids) {
    const m = /^(?:play|playCovered):(.+?)(paus|copas|espadas|ouros)$/.exec(id);
    if (m !== null) out.push({ rank: m[1] as Card['rank'], suit: m[2] as Card['suit'] });
  }
  return out;
}

interface Truth {
  /** Cartas que o assento PODE conhecer: abertas na mesa, vira, mão própria, parceiro na decisão, próprias cobertas. */
  allowed: Set<string>;
  /** Cartas que NÃO pode conhecer: mão alheia (salvo parceiro na decisão) e cobertas alheias. */
  forbidden: Set<string>;
  ownHand: Card[];
}

function truthFor(series: SeriesState, seat: Seat): Truth {
  const h = series.match.hand;
  const allowed = new Set<string>();
  const forbidden = new Set<string>();
  if (h.vira !== null) allowed.add(key(h.vira));
  const plays = [...h.tricks.flatMap((t) => t.plays), ...h.current];
  for (const p of plays) {
    if (!p.covered) allowed.add(key(p.card));
    else if (p.seat === seat) allowed.add(key(p.card));
    else forbidden.add(key(p.card));
  }
  const ferro = h.special === 'maoDeFerro';
  const decider = h.phase === 'specialDecision' && teamOf(seat) === h.specialTeam;
  const ownHand: Card[] = [];
  h.hands.forEach((cards, s) => {
    for (const c of cards) {
      if (s === seat) {
        if (!ferro) {
          allowed.add(key(c));
          ownHand.push(c);
        } else forbidden.add(key(c)); // dono às cegas também não vê
      } else if (decider && teamOf(s) === teamOf(seat)) allowed.add(key(c));
      else forbidden.add(key(c));
    }
  });
  return { allowed, forbidden, ownHand };
}

interface Shape {
  privates?: Record<string, { seat: number; hand: Card[]; legalActions: string[] }>;
}

function checkClientView(json: unknown, series: SeriesState, seat: Seat, label: string): void {
  const truth = truthFor(series, seat);
  const found: { path: string; card: Card }[] = [];
  sightings(json, 'state', found);
  for (const f of found) {
    expect(
      truth.forbidden.has(key(f.card)),
      `${label}: carta proibida ${key(f.card)} em ${f.path}`,
    ).toBe(false);
    expect(
      truth.allowed.has(key(f.card)),
      `${label}: carta desconhecida ${key(f.card)} em ${f.path}`,
    ).toBe(true);
  }
  const ids = (json as Shape).privates;
  expect(ids, `${label}: privates ausente`).toBeDefined();
  const entries = Object.values(ids ?? {});
  // Só o bloco do próprio assento chega ao cliente.
  expect(entries.map((e) => e.seat)).toEqual([seat]);
  const mine = entries[0];
  expect(mine).toBeDefined();
  if (mine === undefined) return;
  expect(mine.legalActions, label).toEqual(legalActionIds(series, seat));
  for (const c of idCards(mine.legalActions)) {
    expect(truth.forbidden.has(key(c)), `${label}: legalAction cita carta proibida`).toBe(false);
  }
  const ferro = series.match.hand.special === 'maoDeFerro';
  if (ferro) expect(mine.hand, `${label}: mão de ferro sem cartas`).toEqual([]);
  else expect(mine.hand.map(key).sort(), label).toEqual(truth.ownHand.map(key).sort());
  // handSize público continua correto.
  const sizes = (json as { players: { handSize: number }[] }).players.map((p) => p.handSize);
  expect(sizes).toEqual(series.match.hand.hands.map((x) => x.length));
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
      checkClientView(
        sim.json(c),
        series,
        c.seat,
        `seed ${sc.seed} passo ${steps} assento ${c.seat} (long)`,
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
