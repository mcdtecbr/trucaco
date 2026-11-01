import { describe, expect, it } from 'vitest';
import {
  applySeriesAction,
  botAction,
  cancelSeries,
  legalActions,
  mulberry32,
  PAULISTA,
  startSeries,
} from './index';
import type { GameEvent, HandAction, SeriesConfig, SeriesState, Team } from './index';

/**
 * Joga o jogo corrente até acabar; `favored` pede truco sempre que pode e a outra dupla corre,
 * de modo que o resultado é determinado. Para no fim do jogo (ou da série).
 */
function playGame(
  s0: SeriesState,
  favored: Team,
  rng: () => number,
): { state: SeriesState; events: GameEvent[] } {
  let state = s0;
  const events: GameEvent[] = [];
  const game = state.gameNumber;
  for (let i = 0; i < 5000; i++) {
    if (state.gameNumber !== game || state.winner !== null) return { state, events };
    if (state.match.winner !== null) return { state, events };
    let action: HandAction | null = null;
    for (let seat = 0; seat < state.seats && action === null; seat++) {
      const legal = legalActions(state, seat);
      if (legal.length === 0) continue;
      const mine = (seat % 2) as Team;
      const call = legal.find((a) => a.type === 'callBet');
      const run = legal.find((a) => a.type === 'runBet');
      if (run && mine !== favored) action = run;
      else if (call && mine === favored) action = call;
      else action = botAction(state, seat, rng);
    }
    if (action === null) throw new Error('travado');
    const r = applySeriesAction(state, action, rng);
    if (!r.ok) throw new Error(r.error.code);
    state = r.state;
    events.push(...r.events);
  }
  throw new Error('loop');
}

function runSeries(config: SeriesConfig, winners: Team[]) {
  const rng = mulberry32(5);
  const start = startSeries({ variant: PAULISTA, config, rng });
  let state = start.state;
  const all: GameEvent[] = [...start.events];
  const pes: number[] = [];
  for (const w of winners) {
    const r = playGame(state, w, rng);
    pes.push(state.match.hand.pe);
    state = r.state;
    all.push(...r.events);
  }
  return { state, all };
}

describe('série', () => {
  it('single equivale a um único jogo', () => {
    const { state, all } = runSeries({ format: 'single' }, [1]);
    expect(state.winner).toBe(1);
    expect(state.games).toEqual([0, 1]);
    expect(all.at(-1)?.type).toBe('seriesDecided');
    expect(all.filter((e) => e.type === 'gameStarted')).toHaveLength(1);
    expect(applySeriesAction(state, { type: 'callBet', seat: 0 }, mulberry32(1)).ok).toBe(false);
  });

  it('bo3 termina em 2x0', () => {
    const { state, all } = runSeries({ format: 'bo3' }, [0, 0]);
    expect(state.winner).toBe(0);
    expect(state.games).toEqual([2, 0]);
    expect(all.filter((e) => e.type === 'gameDecided')).toHaveLength(2);
  });

  it('bo3 1x1 leva ao terceiro jogo e termina em 2x1', () => {
    const { state, all } = runSeries({ format: 'bo3' }, [0, 1, 1]);
    expect(state.winner).toBe(1);
    expect(state.games).toEqual([1, 2]);
    expect(state.history).toEqual([0, 1, 1]);
    expect(all.filter((e) => e.type === 'gameStarted')).toHaveLength(3);
  });

  it('1x1 ainda não decide a série', () => {
    const { state } = runSeries({ format: 'bo3' }, [0, 1]);
    expect(state.winner).toBeNull();
    expect(state.gameNumber).toBe(3);
    expect(state.match.scores).toEqual([0, 0]);
  });

  it('reinicia o placar e o pé segue o rodízio após a última mão do jogo', () => {
    const rng = mulberry32(5);
    const start = startSeries({ variant: PAULISTA, config: { format: 'bo3' }, rng });
    const r = playGame(start.state, 0, rng);
    // pé da última mão do jogo 1 = pé do evento handStarted anterior ao gameStarted 2
    const idx = r.events.findIndex((e) => e.type === 'gameStarted');
    const lastPe = [...r.events.slice(0, idx)].reverse().find((e) => e.type === 'handStarted');
    const firstPe = r.events.slice(idx).find((e) => e.type === 'handStarted');
    if (lastPe?.type !== 'handStarted' || firstPe?.type !== 'handStarted') throw new Error('x');
    // o último handStarted antes do gameStarted 2 é o da mão em curso quando o jogo acabou? não:
    // o jogo acaba na mão que deu os pontos; seu pé é o do handStarted anterior ao handDecided final.
    const decided = r.events.findIndex((e) => e.type === 'gameDecided');
    const peOfLastHand = [...r.events.slice(0, decided)]
      .reverse()
      .find((e) => e.type === 'handStarted');
    if (peOfLastHand?.type !== 'handStarted') throw new Error('x');
    expect(firstPe.pe).toBe((peOfLastHand.pe + 1) % 4);
    expect(r.state.match.scores).toEqual([0, 0]);
    expect(r.state.match.handNumber).toBe(1);
    expect(r.state.games).toEqual([1, 0]);
  });

  it('cancelar marca a série sem vencedor e bloqueia ações', () => {
    const rng = mulberry32(3);
    const { state } = startSeries({ variant: PAULISTA, config: { format: 'bo3' }, rng });
    const c = cancelSeries(state);
    if (!c.ok) throw new Error('x');
    expect(c.state.cancelled).toBe(true);
    expect(c.state.winner).toBeNull();
    expect(c.events).toEqual([{ type: 'seriesCancelled' }]);
    expect(legalActions(c.state, c.state.match.hand.turn)).toEqual([]);
    const r = applySeriesAction(c.state, { type: 'callBet', seat: 0 }, rng);
    expect(r.ok).toBe(false);
    expect(cancelSeries(c.state).ok).toBe(false);
  });
});
