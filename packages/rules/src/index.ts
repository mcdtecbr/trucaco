/**
 * Motor de regras do Truco (Paulista e Mineiro). Puro: sem rede, banco, UI, relógio ou aleatoriedade
 * (RNG injetado). Regras normativas em docs/regras-truco.md.
 */
export const RULES_ENGINE_READY = true;

export { RANKS, SUITS } from './cards';
export type { Card, Rank, Suit, VariantId } from './cards';
export { DEFAULT_SEATS, otherTeam, nextSeat, teamOf } from './types';
export type { Result, RuleError, RuleErrorCode, Seat, Team } from './types';
export { mulberry32 } from './rng';
export type { Rng } from './rng';
export { GAME_POINTS, MINEIRO, PAULISTA, variantById } from './variant';
export type { Variant } from './variant';
export { CARDS_PER_HAND, cardEquals, createDeck, deal, shuffle } from './deck';
export type { Deal } from './deck';
export { cardStrength, compareCards, isManilha, manilhaRank } from './strength';
export { applyHandAction, startHand, startHandFromCards } from './hand';
export type {
  HandAction,
  HandEndReason,
  HandOutcome,
  HandPhase,
  HandState,
  PendingBet,
  PlayedCard,
  SpecialKind,
  StartHandFromCards,
  StartHandParams,
  Trick,
} from './hand';
export { viewFor } from './view';
export type { HandView, PlayedCardView, TrickView } from './view';
export { handEvents, publicEvent, scoresAfterHand } from './events';
export type { ActionResult, GameEvent, PublicGameEvent, Transition } from './events';
export { applyMatchAction, startMatch } from './match';
export type { MatchState, StartMatchParams } from './match';
export { applySeriesAction, cancelSeries, gamesToWin, isSeriesOver, startSeries } from './series';
export type { SeriesConfig, SeriesState, StartSeriesParams } from './series';
export { legalActions, pendingSeat } from './legal';
export { botAction } from './bot';
