import type { Card } from './cards';
import type { HandAction, HandEndReason, HandState, SpecialKind } from './hand';
import { GAME_POINTS } from './variant';
import type { RuleError, RuleErrorCode, Seat, Team } from './types';

/**
 * Evento emitido a cada transição. Definido aqui porque `rules` não pode importar `@trucaco/*`;
 * o servidor mapeia para o protocolo. A versão enviada a todos passa por `publicEvent`.
 */
export type GameEvent =
  | { readonly type: 'gameStarted'; readonly gameNumber: number }
  | {
      readonly type: 'handStarted';
      readonly handNumber: number;
      readonly pe: Seat;
      readonly scores: readonly [number, number];
      readonly special: SpecialKind;
    }
  | {
      readonly type: 'cardPlayed';
      readonly seat: Seat;
      readonly card: Card;
      readonly covered: boolean;
      readonly blind: boolean;
    }
  | {
      readonly type: 'trickDecided';
      readonly index: number;
      readonly winnerSeat: Seat | null;
      readonly winnerTeam: Team | null;
    }
  | {
      readonly type: 'betCalled';
      readonly seat: Seat;
      readonly toLevel: number;
      readonly value: number;
    }
  | { readonly type: 'betAccepted'; readonly seat: Seat; readonly value: number }
  | {
      readonly type: 'betRaised';
      readonly seat: Seat;
      readonly toLevel: number;
      readonly value: number;
    }
  | {
      readonly type: 'betRun';
      readonly seat: Seat;
      readonly winnerTeam: Team;
      readonly points: number;
    }
  | { readonly type: 'specialDecided'; readonly seat: Seat; readonly decision: 'play' | 'run' }
  | {
      readonly type: 'handDecided';
      readonly winnerTeam: Team | null;
      readonly points: number;
      readonly reason: HandEndReason;
      /** Placar do jogo depois de somar a mão. */
      readonly scores: readonly [number, number];
    }
  | {
      readonly type: 'gameDecided';
      readonly winnerTeam: Team;
      readonly scores: readonly [number, number];
    }
  | {
      readonly type: 'seriesDecided';
      readonly winnerTeam: Team;
      readonly games: readonly [number, number];
    }
  | { readonly type: 'seriesCancelled' };

/** Evento seguro para todos os assentos: carta coberta ou às cegas sem identidade. */
export type PublicGameEvent =
  | Exclude<GameEvent, { type: 'cardPlayed' }>
  | {
      readonly type: 'cardPlayed';
      readonly seat: Seat;
      readonly card: Card | null;
      readonly covered: boolean;
      readonly blind: boolean;
    };

/** Remove a identidade de carta coberta. `viewer` (o próprio jogador) pode ver a sua coberta. */
export function publicEvent(event: GameEvent, viewer?: Seat): PublicGameEvent {
  if (event.type !== 'cardPlayed') return event;
  // Coberta: só o próprio jogador a vê. Às cegas (mão de ferro): escolhida sem ver, mas
  // aberta e visível a toda a mesa ao ser jogada.
  const hidden = event.covered && event.seat !== viewer;
  return { ...event, card: hidden ? null : event.card };
}

export interface Transition<S> {
  readonly state: S;
  readonly events: readonly GameEvent[];
}

export type ActionResult<S> =
  | ({ readonly ok: true } & Transition<S>)
  | { readonly ok: false; readonly error: RuleError };

/** Placar depois de somar os pontos da mão decidida (limitado a 12). */
export function scoresAfterHand(hand: HandState): readonly [number, number] {
  const r = hand.result;
  const s: [number, number] = [hand.scores[0], hand.scores[1]];
  if (r !== null && r.winnerTeam !== null) {
    s[r.winnerTeam] = Math.min(GAME_POINTS, s[r.winnerTeam] + r.points);
  }
  return s;
}

/** Eventos de uma transição de mão (before --action--> after). */
export function handEvents(before: HandState, action: HandAction, after: HandState): GameEvent[] {
  const events: GameEvent[] = [];
  const ladder = before.variant.betLadder;
  switch (action.type) {
    case 'playCard':
    case 'playBlindCard': {
      const blind = action.type === 'playBlindCard';
      const card = blind ? before.hands[action.seat]?.[action.index] : action.card;
      if (card !== undefined) {
        events.push({
          type: 'cardPlayed',
          seat: action.seat,
          card,
          covered: !blind && action.covered === true,
          blind,
        });
      }
      if (after.tricks.length > before.tricks.length) {
        const t = after.tricks[after.tricks.length - 1];
        if (t !== undefined)
          events.push({
            type: 'trickDecided',
            index: after.tricks.length - 1,
            winnerSeat: t.winnerSeat,
            winnerTeam: t.winnerTeam,
          });
      }
      break;
    }
    case 'callBet': {
      const toLevel = after.pending?.toLevel ?? before.level + 1;
      events.push({ type: 'betCalled', seat: action.seat, toLevel, value: ladder[toLevel] ?? 0 });
      break;
    }
    case 'acceptBet':
      events.push({ type: 'betAccepted', seat: action.seat, value: after.value });
      break;
    case 'raiseBet': {
      const toLevel = after.pending?.toLevel ?? 0;
      events.push({ type: 'betRaised', seat: action.seat, toLevel, value: ladder[toLevel] ?? 0 });
      break;
    }
    case 'runBet':
      if (after.result?.winnerTeam != null)
        events.push({
          type: 'betRun',
          seat: action.seat,
          winnerTeam: after.result.winnerTeam,
          points: after.result.points,
        });
      break;
    case 'playSpecial':
      events.push({ type: 'specialDecided', seat: action.seat, decision: 'play' });
      break;
    case 'runSpecial':
      events.push({ type: 'specialDecided', seat: action.seat, decision: 'run' });
      break;
  }
  if (before.phase !== 'finished' && after.phase === 'finished' && after.result !== null) {
    events.push({
      type: 'handDecided',
      winnerTeam: after.result.winnerTeam,
      points: after.result.points,
      reason: after.result.reason,
      scores: scoresAfterHand(after),
    });
  }
  return events;
}

export function failAction<S>(code: RuleErrorCode, message: string): ActionResult<S> {
  return { ok: false, error: { code, message } };
}
