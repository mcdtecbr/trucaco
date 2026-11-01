import type { HandAction } from './hand';
import { failAction } from './events';
import type { ActionResult, GameEvent, Transition } from './events';
import { applyMatchAction, startMatch } from './match';
import type { MatchState } from './match';
import type { Rng } from './rng';
import { DEFAULT_SEATS, nextSeat } from './types';
import type { Seat, Team } from './types';
import type { Variant } from './variant';

export interface SeriesConfig {
  /** single = um jogo de 12 pontos; bo3 = melhor de 3 jogos. */
  readonly format: 'single' | 'bo3';
}

export interface SeriesState {
  readonly variant: Variant;
  readonly seats: number;
  readonly config: SeriesConfig;
  readonly match: MatchState;
  /** Jogo em curso, a partir de 1. */
  readonly gameNumber: number;
  /** Jogos vencidos por dupla. */
  readonly games: readonly [number, number];
  /** Vencedor de cada jogo já encerrado, em ordem. */
  readonly history: readonly Team[];
  readonly winner: Team | null;
  readonly cancelled: boolean;
}

export interface StartSeriesParams {
  readonly variant: Variant;
  readonly seats?: number;
  readonly config: SeriesConfig;
  readonly pe?: Seat;
  readonly rng: Rng;
}

export function gamesToWin(config: SeriesConfig): number {
  return config.format === 'bo3' ? 2 : 1;
}

export function startSeries(p: StartSeriesParams): Transition<SeriesState> {
  const seats = p.seats ?? DEFAULT_SEATS;
  const m = startMatch({ variant: p.variant, seats, pe: p.pe, rng: p.rng });
  const state: SeriesState = {
    variant: p.variant,
    seats,
    config: p.config,
    match: m.state,
    gameNumber: 1,
    games: [0, 0],
    history: [],
    winner: null,
    cancelled: false,
  };
  return { state, events: [{ type: 'gameStarted', gameNumber: 1 }, ...m.events] };
}

export function isSeriesOver(s: SeriesState): boolean {
  return s.winner !== null || s.cancelled;
}

export function applySeriesAction(
  state: SeriesState,
  action: HandAction,
  rng: Rng,
): ActionResult<SeriesState> {
  if (isSeriesOver(state)) return failAction('SERIES_FINISHED', 'a série já terminou');
  const r = applyMatchAction(state.match, action, rng);
  if (!r.ok) return { ok: false, error: r.error };
  const events: GameEvent[] = [...r.events];
  const w = r.state.winner;
  if (w === null) return { ok: true, state: { ...state, match: r.state }, events };
  const games: [number, number] = [state.games[0], state.games[1]];
  games[w] += 1;
  const history = [...state.history, w];
  if (games[w] >= gamesToWin(state.config)) {
    events.push({ type: 'seriesDecided', winnerTeam: w, games });
    return { ok: true, state: { ...state, match: r.state, games, history, winner: w }, events };
  }
  // Placar zera; assentos e duplas ficam; o pé segue o rodízio.
  const pe = nextSeat(r.state.hand.pe, state.seats);
  const m = startMatch({ variant: state.variant, seats: state.seats, pe, rng });
  const gameNumber = state.gameNumber + 1;
  events.push({ type: 'gameStarted', gameNumber }, ...m.events);
  return { ok: true, state: { ...state, match: m.state, gameNumber, games, history }, events };
}

/** Mesa encerrada por voto: série sem vencedor. */
export function cancelSeries(state: SeriesState): ActionResult<SeriesState> {
  if (isSeriesOver(state)) return failAction('SERIES_FINISHED', 'a série já terminou');
  return {
    ok: true,
    state: { ...state, cancelled: true },
    events: [{ type: 'seriesCancelled' }],
  };
}
