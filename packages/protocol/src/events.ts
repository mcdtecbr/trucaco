import type { Card } from './cards';
import type { Seat, Team } from './room';

export type SpecialKind = 'normal' | 'maoDeOnze' | 'maoDeFerro';
export type HandEndReason = 'tricks' | 'betRun' | 'specialRun' | 'draw';

/**
 * Evento público de jogo. DEVE ficar estruturalmente igual a `PublicGameEvent` de
 * `packages/rules/src/events.ts` (protocol não importa rules). O servidor atribui
 * `const e: PublicGameEvent = publicEvent(ev, seat)` e o `tsc` acusa divergência.
 *
 * - `betRaised` implica aceitação do degrau anterior: o cliente infere o `betAccepted`
 *   implícito (quem aumenta aceita a aposta pendente e propõe a nova).
 * - `cardPlayed.card` é `null` para carta coberta de outro jogador.
 */
export type PublicGameEvent =
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
      readonly card: Card | null;
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

/** Ids dos gritos de aposta (docs/audio.md). */
export const BET_CRY_IDS = ['truco', 'seis', 'oito', 'nove', 'dez', 'doze'] as const;
export type BetCryId = (typeof BET_CRY_IDS)[number];

/** Valor da aposta -> grito. 3 (Paulista) e 4 (Mineiro) são o primeiro aumento: `truco`. */
export const BET_CRY_BY_VALUE: Readonly<Record<number, BetCryId>> = Object.freeze({
  3: 'truco',
  4: 'truco',
  6: 'seis',
  8: 'oito',
  9: 'nove',
  10: 'dez',
  12: 'doze',
});

/** Grito para o valor da aposta, ou `undefined` se o valor não existe em nenhuma escada. */
export function betCry(value: number): BetCryId | undefined {
  return Object.hasOwn(BET_CRY_BY_VALUE, value) ? BET_CRY_BY_VALUE[value] : undefined;
}
