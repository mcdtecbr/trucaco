/** Assento na mesa: 0..seats-1, no sentido de jogo. Duplas: assento % 2. */
export type Seat = number;

/** Dupla: 0 (assentos pares) ou 1 (assentos ímpares). */
export type Team = 0 | 1;

export const DEFAULT_SEATS = 4;

export function teamOf(seat: Seat): Team {
  return seat % 2 === 0 ? 0 : 1;
}

export function otherTeam(team: Team): Team {
  return team === 0 ? 1 : 0;
}

export function nextSeat(seat: Seat, seats: number): Seat {
  return (seat + 1) % seats;
}

export type RuleErrorCode =
  | 'INVALID_SEAT'
  | 'HAND_FINISHED'
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'COVERED_NOT_ALLOWED'
  | 'BLIND_ONLY'
  | 'NOT_BLIND_HAND'
  | 'BET_NOT_ALLOWED'
  | 'BET_PENDING'
  | 'NO_PENDING_BET'
  | 'SPECIAL_DECISION_PENDING'
  | 'NO_SPECIAL_DECISION'
  | 'GAME_FINISHED'
  | 'SERIES_FINISHED';

export interface RuleError {
  readonly code: RuleErrorCode;
  readonly message: string;
}

export type Result<T> =
  | { readonly ok: true; readonly state: T }
  | { readonly ok: false; readonly error: RuleError };

export function ok<T>(state: T): Result<T> {
  return { ok: true, state };
}

export function fail<T>(code: RuleErrorCode, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}
