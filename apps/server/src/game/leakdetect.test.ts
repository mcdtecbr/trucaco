/**
 * Testes do PRÓPRIO detector de vazamento. Cada ponto cego do detector antigo (`legacyViolations`,
 * cópia fiel da lógica anterior) ganha um teste negativo: o antigo NÃO acusa, o novo acusa.
 * E um controle positivo: estado honesto não gera falso positivo.
 */
import { ArraySchema } from '@colyseus/schema';
import {
  applySeriesAction,
  legalActions,
  mulberry32,
  startSeries,
  variantById,
} from '@trucaco/rules';
import type { Card, SeriesState, Seat } from '@trucaco/rules';
import { describe, expect, it } from 'vitest';
import { TruthLog, cardsInText, key, leakViolations, truthFor } from './leakdetect';
import { projectState } from './projection';
import { PlayedCardSchema, createTableState } from './schema';
import type { PlayedCardNode } from './schema';
import { WireSim } from './testkit';

/** Detector ANTIGO: só objetos com `rank` e `suit`, só a árvore do `toJSON`, só proibidas. */
function legacyViolations(json: unknown, series: SeriesState, seat: Seat): string[] {
  const found: Card[] = [];
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n === null || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    if (
      typeof o.rank === 'string' &&
      typeof o.suit === 'string' &&
      o.rank !== '' &&
      o.suit !== ''
    ) {
      found.push({ rank: o.rank as Card['rank'], suit: o.suit as Card['suit'] });
    }
    Object.values(o).forEach(walk);
  };
  walk(json);
  const { forbidden } = truthFor(series, seat);
  return found.filter((c) => forbidden.has(key(c))).map((c) => `proibida ${key(c)}`);
}

function setup(): {
  series: SeriesState;
  rng: () => number;
  sim: WireSim;
  state: ReturnType<typeof createTableState>;
  viewer: Seat;
  victim: Seat;
  leaked: Card;
} {
  const rng = mulberry32(9);
  const series = startSeries({
    variant: variantById('paulista'),
    config: { format: 'single', ironHand: true },
    pe: 0,
    rng,
  }).state;
  const state = createTableState('ABCD2345', {
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'private',
  });
  projectState(series, state);
  const sim = new WireSim(state);
  const turn = series.match.hand.turn;
  const victim = turn;
  const viewer = ((turn + 1) % 4) as Seat;
  const leaked = series.match.hand.hands[victim]?.[0] as Card;
  return { series, rng, sim, state, viewer, victim, leaked };
}

const clone = (v: unknown): unknown => JSON.parse(JSON.stringify(v));

describe('detector de vazamento: controle positivo (sem falso positivo)', () => {
  it('cartas permitidas (vira, própria mão, abertas) não são acusadas, nem em strings nem em refs', () => {
    const { series, sim, viewer } = setup();
    const c = sim.connect(viewer);
    sim.flush();
    expect(leakViolations(sim.json(c), series, viewer, 'ok', { decoder: c.decoder })).toEqual([]);
  });

  it('reconhece os formatos de carta em texto e ignora texto parecido', () => {
    const keys = (t: string): string[] => cardsInText(t).map(key);
    expect(keys('3paus')).toEqual(['3paus']);
    expect(keys('play:Kouros')).toEqual(['Kouros']);
    expect(keys('playCovered:7copas')).toEqual(['7copas']);
    expect(keys('{"head":"A de espadas"}')).toEqual(['Aespadas']);
    expect(keys('Q-ouros 4_paus 7♦')).toEqual(['Qouros', '4paus', '7ouros']);
    expect(keys('13paus Rocouros Jogador 3 playBlind:1 maoDeFerro')).toEqual([]);
  });
});

describe('ponto cego (a): carta fora de objetos rank+suit', () => {
  it('viraRank/viraSuit trocados pela carta de outro assento: antigo cego, novo acusa', () => {
    const { series, sim, state, viewer, leaked } = setup();
    const c = sim.connect(viewer);
    state.hand.viraRank = leaked.rank;
    state.hand.viraSuit = leaked.suit;
    sim.flush();
    expect(legacyViolations(sim.json(c), series, viewer)).toEqual([]);
    const bad = leakViolations(sim.json(c), series, viewer, 'vira', { exact: false });
    expect(bad.join('\n')).toContain(`carta proibida ${key(leaked)}`);
  });

  it.each([
    ['special', (k: string) => ({ special: k })],
    ['nickname', (k: string) => ({ nickname: `Jogador ${k}` })],
    ['avatar', (k: string) => ({ avatar: JSON.stringify({ hat: 'x', mao: k }) })],
  ] as const)('carta concatenada em %s: antigo cego, novo acusa', (field, build) => {
    const { series, sim, state, viewer, leaked } = setup();
    const c = sim.connect(viewer);
    const patch = build(key(leaked)) as Record<string, string>;
    if (field === 'special') state.hand.special = patch.special as string;
    else (state.players[1] as unknown as Record<string, string>)[field] = patch[field] as string;
    sim.flush();
    expect(legacyViolations(sim.json(c), series, viewer)).toEqual([]);
    const bad = leakViolations(sim.json(c), series, viewer, field, { exact: false });
    expect(bad.join('\n')).toContain(`carta proibida ${key(leaked)}`);
  });

  it('id de ação em array de string citando carta alheia (legalActions): novo acusa', () => {
    const { series, sim, viewer, leaked } = setup();
    const c = sim.connect(viewer);
    sim.flush();
    const json = clone(sim.json(c)) as { privates: Record<string, { legalActions: string[] }> };
    Object.values(json.privates)[0]?.legalActions.push(`play:${key(leaked)}`);
    expect(legacyViolations(json, series, viewer)).toEqual([]);
    expect(leakViolations(json, series, viewer, 'ids', { exact: false }).length).toBeGreaterThan(0);
  });

  it('rank e suit em campos de nomes diferentes: antigo cego, novo acusa', () => {
    const { series, sim, viewer, leaked } = setup();
    const c = sim.connect(viewer);
    sim.flush();
    const json = clone(sim.json(c)) as { players: Record<string, unknown>[] };
    json.players[1] = { ...json.players[1], valor: leaked.rank, naipe: leaked.suit };
    expect(legacyViolations(json, series, viewer)).toEqual([]);
    const bad = leakViolations(json, series, viewer, 'nomes', { exact: false });
    expect(bad.join('\n')).toContain(`carta proibida ${key(leaked)}`);
  });
});

describe('ponto cego (b): ref solto do decoder fora da árvore do toJSON', () => {
  it('carta alheia que sobrou em ref do decoder: antigo cego, novo acusa', () => {
    const { series, sim, state, viewer, victim, leaked } = setup();
    const c = sim.connect(viewer);
    const p = new PlayedCardSchema();
    p.seat = victim;
    p.rank = leaked.rank;
    p.suit = leaked.suit;
    state.hand.current.push(p);
    sim.flush();
    const clientHand = c.decoder.state.hand;
    const refsBefore = c.decoder.root.refs.size;
    // Cliente desanexa o nó da árvore; o ref continua guardado no decoder.
    clientHand.current = new ArraySchema<PlayedCardNode>();
    expect(c.decoder.root.refs.size).toBe(refsBefore);
    expect(legacyViolations(sim.json(c), series, viewer)).toEqual([]);
    expect(leakViolations(sim.json(c), series, viewer, 'árvore', { exact: false })).toEqual([]);
    const bad = leakViolations(sim.json(c), series, viewer, 'refs', {
      exact: false,
      decoder: c.decoder,
    });
    expect(bad.join('\n')).toContain(`carta proibida ${key(leaked)} em ref#`);
  });
});

describe('ponto cego (c): patch contra a verdade da época, não a atual', () => {
  /** Vaza a carta do dono da vez um passo antes de ele jogá-la aberta. */
  function leakThenOpen(): {
    leakedJson: unknown;
    log: TruthLog;
    current: SeriesState;
    cleanJson: unknown;
    viewer: Seat;
    leaked: Card;
  } {
    const { series, rng, sim, state, viewer, victim, leaked } = setup();
    const c = sim.connect(viewer);
    sim.flush();
    const log = new TruthLog();
    log.record(series, state.toJSON());
    expect(log.violations(sim.json(c), viewer, 'base', { decoder: c.decoder })).toEqual([]);
    // Passo k: o servidor "projeta" a carta do dono como já jogada, ainda na mão dele.
    const p = new PlayedCardSchema();
    p.seat = victim;
    p.rank = leaked.rank;
    p.suit = leaked.suit;
    state.hand.current.push(p);
    log.record(series, state.toJSON());
    sim.flush();
    const leakedJson = clone(sim.json(c));
    // Passo k+1: a jogada acontece de verdade, e a carta passa a ser pública.
    const action = legalActions(series, victim).find(
      (a) => a.type === 'playCard' && a.covered !== true && key(a.card) === key(leaked),
    );
    expect(action).toBeDefined();
    const r = applySeriesAction(series, action as NonNullable<typeof action>, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('jogada inválida');
    projectState(r.state, state);
    log.record(r.state, state.toJSON());
    sim.flush();
    return { leakedJson, log, current: r.state, cleanJson: clone(sim.json(c)), viewer, leaked };
  }

  it('antigo: o patch vazado passa contra a série ATUAL; novo: acusa pela versão da época', () => {
    const { leakedJson, log, current, viewer, leaked } = leakThenOpen();
    // Contra a série atual a carta já está aberta: o detector antigo (exact:false) não vê nada.
    expect(legacyViolations(leakedJson, current, viewer)).toEqual([]);
    expect(leakViolations(leakedJson, current, viewer, 'atual', { exact: false })).toEqual([]);
    // Contra a verdade da época do patch, é vazamento.
    const bad = log.violations(leakedJson, viewer, 'época', { exact: false });
    expect(bad.join('\n')).toContain(`carta proibida ${key(leaked)}`);
  });

  it('o patch seguinte, legítimo, não gera falso positivo', () => {
    const base = setup();
    // Sem vazamento: duas versões honestas, cada patch conferido na sua época.
    const c = base.sim.connect(base.viewer);
    base.sim.flush();
    const log = new TruthLog();
    log.record(base.series, base.state.toJSON());
    expect(log.violations(base.sim.json(c), base.viewer, 'v0', { decoder: c.decoder })).toEqual([]);
    const action = legalActions(base.series, base.victim).find((a) => a.type === 'playCard');
    const r = applySeriesAction(base.series, action as NonNullable<typeof action>, base.rng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    projectState(r.state, base.state);
    log.record(r.state, base.state.toJSON());
    base.sim.flush();
    expect(log.violations(base.sim.json(c), base.viewer, 'v1', { decoder: c.decoder })).toEqual([]);
  });

  it('estado do cliente que não corresponde a nenhuma versão é reportado', () => {
    const { series, sim, state, viewer } = setup();
    const c = sim.connect(viewer);
    sim.flush();
    const log = new TruthLog();
    log.record(series, state.toJSON());
    state.hand.value = 99;
    sim.flush();
    expect(log.violations(sim.json(c), viewer, 'sem versão').join('\n')).toContain(
      'não corresponde a nenhuma versão',
    );
  });
});
