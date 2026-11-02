/**
 * Contrato `TableState` (schema do servidor) <-> `TableStateSnapshot` (protocol): o que o cliente decodifica
 * tem de caber no tipo do protocol (compile-time, via `toJSON()`) e respeitar as convenções (runtime).
 */
import {
  applySeriesAction,
  legalActions,
  mulberry32,
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

describe('contrato TableState <-> TableStateSnapshot', () => {
  for (const sc of SAMPLES) {
    it(`${sc.name}: o que o cliente decodifica cabe no snapshot e respeita as convenções`, () => {
      const { series, state } = build(sc);
      const played = advance(series, 6, mulberry32(9));
      projectState(played, state, { turnDeadlineAt: 1234 });
      const sim = new WireSim(state);
      for (const seat of [0, 1, 2, 3]) {
        const json = sim.snapshotFor(seat) as ReturnType<TableState['toJSON']>;
        const snap = asSnapshot(json);
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
      }
    });
  }

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
    // ATENÇÃO: string nunca atribuída no schema (`t.string()` sem padrão) sai `undefined` do toJSON/decoder
    // até a primeira projeção (fase `waiting`). O cliente deve normalizar com `?? NO_CARD`.
    expect(snap.hand.viraRank ?? NO_CARD).toBe(NO_CARD);
    expect(snap.hand.pending).toBeUndefined();
    expect(snap.phase).toBe('waiting');
  });
});
