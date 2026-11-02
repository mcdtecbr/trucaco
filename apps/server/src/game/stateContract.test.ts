/**
 * Contrato `TableState` (schema do servidor) <-> `TableStateSnapshot` (protocol): o que o cliente decodifica
 * tem de caber no tipo do protocol (compile-time, via `toJSON()`) e respeitar as convenções (runtime).
 */
import {
  applySeriesAction,
  PAULISTA,
  legalActions,
  manilhaRank,
  mulberry32,
  pendingSeat,
  startHand,
  startSeries,
  variantById,
} from '@trucaco/rules';
import type { SeriesState, VariantId } from '@trucaco/rules';
import {
  ABSENT,
  NO_CARD,
  isHandPhaseId,
  isPlayerStatusId,
  isTablePhase,
  parseLegalAction,
} from '@trucaco/protocol';
import type { TableStateSnapshot } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import { projectState } from './projection';
import { createTableState } from './schema';
import type { TableState } from './schema';
import { WireSim } from './testkit';

/** Compile-time: o JSON do estado é atribuível ao snapshot do protocol (divergência quebra o typecheck). */
function asSnapshot(json: ReturnType<TableState['toJSON']>): TableStateSnapshot {
  return json;
}

interface Sample {
  readonly name: string;
  readonly variant: VariantId;
  readonly ironHand: boolean;
  readonly scores: readonly [number, number];
}

const SAMPLES: readonly Sample[] = [
  { name: 'mão normal', variant: 'paulista', ironHand: false, scores: [0, 0] },
  { name: 'mão de ferro', variant: 'paulista', ironHand: true, scores: [11, 11] },
  { name: 'mão de onze', variant: 'paulista', ironHand: true, scores: [11, 3] },
  { name: 'mineiro', variant: 'mineiro', ironHand: false, scores: [2, 5] },
];

function build(sc: Sample): { series: SeriesState; state: TableState } {
  const rng = mulberry32(7);
  const variant = variantById(sc.variant);
  let series = startSeries({
    variant,
    config: { format: 'single', ironHand: sc.ironHand },
    pe: 0,
    rng,
  }).state;
  const hand = startHand({ variant, pe: 0, scores: sc.scores, ironHand: sc.ironHand, rng });
  series = { ...series, match: { ...series.match, scores: sc.scores, hand } };
  const state = createTableState('ABCDEFGH', {
    variant: sc.variant,
    format: 'single',
    ironHand: sc.ironHand,
    visibility: 'private',
  });
  state.phase = 'playing';
  projectState(series, state, { turnDeadlineAt: 1234 });
  return { series, state };
}

/** Joga algumas ações legais (preferindo cobertas) para popular `current`/`tricks`/`ownCovered`. */
function advance(series: SeriesState, steps: number, rng: () => number): SeriesState {
  let s = series;
  for (let i = 0; i < steps; i++) {
    for (const seat of [0, 1, 2, 3]) {
      const actions = legalActions(s, seat);
      const a = actions.find((x) => x.type === 'playCard' && x.covered === true) ?? actions[0];
      if (a === undefined) continue;
      const r = applySeriesAction(s, a, rng);
      if (r.ok) s = r.state;
      break;
    }
  }
  return s;
}

/** Todo campo obrigatório do snapshot (tudo menos `hand.pending`) deve existir de verdade no runtime. */
function expectNoUndefinedRequired(snap: TableStateSnapshot): void {
  const walk = (v: unknown, path: string): void => {
    if (path !== 'hand.pending') expect(v, path).not.toBeUndefined();
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  for (const key of [
    'roomCode',
    'phase',
    'players',
    'series',
    'game',
    'turnDeadlineAt',
    'cancelVotes',
    'rematchVotes',
    'rematchDeadlineAt',
    'matchNumber',
    'privates',
  ] as const) {
    walk(snap[key], key);
  }
  walk({ ...snap.hand, pending: 0 }, 'hand');
  walk(snap.options, 'options');
}

describe('contrato TableState <-> TableStateSnapshot', () => {
  /** Verificações comuns a qualquer estado projetado, vistas por cada um dos 4 assentos. */
  function checkAllSeats(state: TableState): TableStateSnapshot[] {
    const sim = new WireSim(state);
    return [0, 1, 2, 3].map((seat) => {
      const snap = asSnapshot(sim.snapshotFor(seat) as ReturnType<TableState['toJSON']>);
      expectNoUndefinedRequired(snap);
      expect(isTablePhase(snap.phase)).toBe(true);
      expect(snap.roomCode).toBe('ABCDEFGH');
      expect(snap.players).toHaveLength(4);
      for (const p of snap.players) expect(isPlayerStatusId(p.status)).toBe(true);
      expect(snap.hand.phase === '' || isHandPhaseId(snap.hand.phase)).toBe(true);
      // Só o próprio bloco privado chega, e as ações legais são todas interpretáveis.
      expect(Object.keys(snap.privates)).toEqual([String(seat)]);
      for (const id of snap.privates[String(seat)]?.legalActions ?? []) {
        expect(parseLegalAction(id)).not.toBeNull();
      }
      // Convenções de ausência.
      for (const c of [...snap.hand.current, ...snap.hand.tricks.flatMap((t) => t.plays)]) {
        if (c.covered) expect([c.rank, c.suit]).toEqual([NO_CARD, NO_CARD]);
      }
      return snap;
    });
  }

  for (const sc of SAMPLES) {
    it(`${sc.name}: o que o cliente decodifica cabe no snapshot e respeita as convenções`, () => {
      const { series, state } = build(sc);
      // Estado ANTES de qualquer jogada.
      const before = checkAllSeats(state);
      if (sc.name === 'mão de onze') {
        expect(before[0]?.hand.phase).toBe('specialDecision');
        for (const seat of [0, 2]) {
          const priv = before[seat]?.privates[String(seat)];
          const kinds = (priv?.legalActions ?? []).map((id) => parseLegalAction(id)?.kind);
          expect(kinds).toContain('specialPlay');
          expect(kinds).toContain('specialRun');
          expect(priv?.partnerCards).toHaveLength(3);
        }
        for (const seat of [1, 3]) {
          const priv = before[seat]?.privates[String(seat)];
          expect(priv?.legalActions.some((id) => id.startsWith('special'))).toBe(false);
          expect(priv?.partnerCards).toHaveLength(0);
        }
      }
      const played = advance(series, 6, mulberry32(9));
      projectState(played, state, { turnDeadlineAt: 1234 });
      checkAllSeats(state);
    });
  }

  it('truco pendente: accept/run/pending chegam ao adversário e passam por parseLegalAction', () => {
    const rng = mulberry32(7);
    const { series, state } = build({
      name: 'normal',
      variant: 'paulista',
      ironHand: false,
      scores: [0, 0],
    });
    const caller = series.match.hand?.turn ?? 0;
    const r = applySeriesAction(series, { type: 'callBet', seat: caller }, rng);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    projectState(r.state, state, { turnDeadlineAt: 1234 });
    const snaps = checkAllSeats(state);
    // truco: só o próximo assento após o pedinte responde; o parceiro dele só assiste
    const responder = (caller + 1) % 4;
    for (const seat of [0, 1, 2, 3]) {
      const snap = snaps[seat];
      expect(snap?.hand.phase).toBe('betPending');
      expect(snap?.hand.pending).toMatchObject({
        fromSeat: caller,
        responderSeat: responder,
        toLevel: expect.any(Number),
      });
      if (seat !== responder) {
        expect(snap?.privates[String(seat)]?.legalActions ?? []).not.toContain('accept');
        continue;
      }
      const kinds = (snap?.privates[String(seat)]?.legalActions ?? []).map(
        (id) => parseLegalAction(id)?.kind,
      );
      expect(kinds).toContain('accept');
      expect(kinds).toContain('run');
    }
  });

  it('actingSeat: jogada normal = turn; aposta pendente = quem responde; onze/dez = ausente (dois decidem); ferro = quem joga; waiting = -1', () => {
    const normal = build({ name: 'n', variant: 'paulista', ironHand: false, scores: [0, 0] });
    const n = checkAllSeats(normal.state)[0]?.hand;
    expect(n?.actingSeat).toBe(n?.turn);
    expect(n?.actingSeat).toBe(pendingSeat(normal.series));

    const caller = normal.series.match.hand.turn;
    const r = applySeriesAction(normal.series, { type: 'callBet', seat: caller }, mulberry32(7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    projectState(r.state, normal.state, { turnDeadlineAt: 1234 });
    const pend = checkAllSeats(normal.state)[0]?.hand;
    expect(pend?.phase).toBe('betPending');
    expect(pend?.turn).toBe(caller);
    expect(pend?.actingSeat).not.toBe(caller);
    expect(pend?.actingSeat).toBe(pendingSeat(r.state));
    expect(pend?.actingSeat).toBe(pend?.pending?.responderSeat);
    expect((pend?.actingSeat ?? 0) % 2).not.toBe(caller % 2);

    const onze = build({ name: 'o', variant: 'paulista', ironHand: true, scores: [11, 3] });
    const o = checkAllSeats(onze.state)[0]?.hand;
    expect(o?.phase).toBe('specialDecision');
    // dois decidem: sem assento único
    expect(o?.actingSeat).toBe(ABSENT);
    expect(o?.specialAccepted).toEqual([]);

    const ferro = build({ name: 'f', variant: 'paulista', ironHand: true, scores: [11, 11] });
    const f = checkAllSeats(ferro.state)[0]?.hand;
    expect(f?.actingSeat).toBe(pendingSeat(ferro.series));
    expect(f?.actingSeat).toBe(f?.turn);

    const waiting = createTableState('ABCDEFGH', {
      variant: 'paulista',
      format: 'single',
      ironHand: false,
      visibility: 'public',
    });
    expect(asSnapshot(waiting.toJSON()).hand.actingSeat).toBe(ABSENT);
  });

  it('manilha e valores de aposta vêm do motor (Paulista, Mineiro, pendente, onze)', () => {
    const paulista = build({ name: 'p', variant: 'paulista', ironHand: false, scores: [0, 0] });
    const p = checkAllSeats(paulista.state)[0]?.hand;
    const vira = paulista.series.match.hand.vira;
    expect(p?.manilhaRank).toBe(manilhaRank(PAULISTA, vira));
    expect(p?.manilhaRank).not.toBe('');
    expect(p?.manilhaCards).toEqual([]);
    expect(p).toMatchObject({ nextBetValue: 3, pendingValue: 0 });

    const mineiro = build({ name: 'm', variant: 'mineiro', ironHand: false, scores: [2, 5] });
    const m = checkAllSeats(mineiro.state)[0]?.hand;
    expect(m?.manilhaRank).toBe('');
    expect(m?.manilhaCards).toEqual(['4paus', '7copas', 'Aespadas', '7ouros']);
    expect(m).toMatchObject({ nextBetValue: 4, pendingValue: 0 });

    // Truco pendente (Paulista): pendente 3, próximo aumento 6.
    const caller = paulista.series.match.hand.turn;
    const r = applySeriesAction(paulista.series, { type: 'callBet', seat: caller }, mulberry32(7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    projectState(r.state, paulista.state, { turnDeadlineAt: 1234 });
    expect(checkAllSeats(paulista.state)[1]?.hand).toMatchObject({
      pendingValue: 3,
      nextBetValue: 6,
    });

    // Mão de onze: decisão especial, sem aposta disponível.
    const onze = build({ name: 'o', variant: 'paulista', ironHand: true, scores: [11, 3] });
    expect(checkAllSeats(onze.state)[0]?.hand).toMatchObject({
      phase: 'specialDecision',
      nextBetValue: 0,
      pendingValue: 0,
    });
  });

  it('convenções do estado inicial: assento/dupla/índice ausente = -1, carta ausente = vazio', () => {
    const state = createTableState('ABCDEFGH', {
      variant: 'mineiro',
      format: 'bo3',
      ironHand: true,
      visibility: 'private',
    });
    const snap = asSnapshot(state.toJSON());
    expect(snap.series.winnerTeam).toBe(ABSENT);
    expect(snap.game.pe).toBe(ABSENT);
    expect(snap.hand.turn).toBe(ABSENT);
    expect(snap.hand.specialTeam).toBe(ABSENT);
    expect(snap.hand.viraRank).toBe(NO_CARD);
    expect(snap.hand.viraSuit).toBe(NO_CARD);
    expect(snap.hand.pending).toBeUndefined();
    expect(snap.hand).toMatchObject({
      manilhaRank: '',
      manilhaCards: [],
      nextBetValue: 0,
      pendingValue: 0,
    });
    expect(snap.phase).toBe('waiting');
    expectNoUndefinedRequired(snap);
    for (const p of snap.players) {
      expect(p).toMatchObject({ nickname: '', avatar: '', handSize: 0, isBot: false });
    }
  });

  it('assento vazio e fase waiting: nenhum campo obrigatório chega undefined (também via WireSim)', () => {
    const state = createTableState('ABCDEFGH', {
      variant: 'paulista',
      format: 'single',
      ironHand: false,
      visibility: 'public',
    });
    const sim = new WireSim(state);
    const snap = asSnapshot(sim.snapshotFor(0) as ReturnType<TableState['toJSON']>);
    expectNoUndefinedRequired(snap);
    expect(snap.hand).toMatchObject({
      viraRank: '',
      viraSuit: '',
      special: '',
      phase: '',
      value: 0,
    });
    expect(snap.turnDeadlineAt).toBe(0);
  });
});
