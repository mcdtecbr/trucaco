import type { Card, VariantId } from './cards';
import type { HandOutcome, HandPhase, PendingBet, SpecialKind, HandState } from './hand';
import { teamOf } from './types';
import type { Seat, Team } from './types';

export interface PlayedCardView {
  readonly seat: Seat;
  /** null: carta coberta de outro jogador. */
  readonly card: Card | null;
  readonly covered: boolean;
}

export interface TrickView {
  readonly starter: Seat;
  readonly plays: readonly PlayedCardView[];
  readonly winnerSeat: Seat | null;
  readonly winnerTeam: Team | null;
}

/** O que um assento pode saber da mão. Nunca contém cartas alheias não reveladas. */
export interface HandView {
  readonly variantId: VariantId;
  readonly seats: number;
  readonly viewer: Seat;
  readonly pe: Seat;
  readonly vira: Card | null;
  /** Cartas do próprio assento; null na mão de ferro (ninguém vê as próprias cartas). */
  readonly ownHand: readonly Card[] | null;
  /** Mão de onze: cartas do parceiro visíveis à dupla que decide. */
  readonly partnerHands: Readonly<Record<number, readonly Card[]>>;
  readonly handSizes: readonly number[];
  readonly scores: readonly [number, number];
  readonly special: SpecialKind;
  readonly specialTeam: Team | null;
  /** Onze/dez: assentos que já aceitaram jogar. */
  readonly specialAccepted: readonly Seat[];
  readonly phase: HandPhase;
  readonly tricks: readonly TrickView[];
  readonly current: readonly PlayedCardView[];
  readonly turn: Seat;
  readonly value: number;
  readonly level: number;
  readonly pending: PendingBet | null;
  readonly result: HandOutcome | null;
}

/** Visão filtrada por assento; é a única forma de o servidor expor a mão aos clientes. */
export function viewFor(state: HandState, seat: Seat): HandView {
  const hide = (p: { seat: Seat; card: Card; covered: boolean }): PlayedCardView => ({
    seat: p.seat,
    covered: p.covered,
    card: p.covered && p.seat !== seat ? null : p.card,
  });
  const ferro = state.special === 'maoDeFerro';
  const sees = state.phase === 'specialDecision' && teamOf(seat) === state.specialTeam;
  const partnerHands: Record<number, readonly Card[]> = {};
  if (sees) {
    state.hands.forEach((h, s) => {
      if (s !== seat && teamOf(s) === teamOf(seat)) partnerHands[s] = [...h];
    });
  }
  return {
    variantId: state.variant.id,
    seats: state.seats,
    viewer: seat,
    pe: state.pe,
    vira: state.vira,
    ownHand: ferro ? null : [...(state.hands[seat] ?? [])],
    partnerHands,
    handSizes: state.hands.map((h) => h.length),
    scores: state.scores,
    special: state.special,
    specialTeam: state.specialTeam,
    specialAccepted: [...state.specialAccepted],
    phase: state.phase,
    tricks: state.tricks.map((t) => ({ ...t, plays: t.plays.map(hide) })),
    current: state.current.map(hide),
    turn: state.turn,
    value: state.value,
    level: state.level,
    pending: state.pending,
    result: state.result,
  };
}
