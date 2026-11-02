/**
 * Espelho plano (sem `@colyseus/*`) do schema da mesa de `apps/server/src/game/schema.ts`, na forma que
 * o cliente guarda depois de projetar `room.state`. O teste de contrato do servidor
 * (`game/stateContract.test.ts`) garante que o `toJSON()` do `TableState` é atribuível a este tipo.
 *
 * Convenções do schema (que não tem `null`): carta ausente = strings `''`; assento/dupla/índice
 * ausente = `-1`. Cartas de outros jogadores NUNCA aparecem: `privates` traz só o bloco do próprio
 * assento (o servidor filtra por `StateView`).
 */
import { RANKS, SUITS } from './cards';
import type { Rank, Suit } from './cards';

/** `rank`/`suit` vazios: sem identidade (vira ausente, coberta alheia). */
export const NO_CARD = '';
/** Assento, dupla ou índice ausente. */
export const ABSENT = -1;

export const TABLE_PHASES = ['waiting', 'playing', 'finished'] as const;
export type TablePhase = (typeof TABLE_PHASES)[number];

/** Fase da mão (`''` antes da primeira). */
export const HAND_PHASES = ['specialDecision', 'playing', 'betPending', 'finished'] as const;
export type HandPhaseId = (typeof HAND_PHASES)[number];

export const PLAYER_STATUSES = ['empty', 'connected', 'away', 'bot'] as const;
export type PlayerStatusId = (typeof PLAYER_STATUSES)[number];

export interface CardSnapshot {
  /** `Rank` ou `''`. */
  readonly rank: string;
  /** `Suit` ou `''`. */
  readonly suit: string;
}

export interface PlayedCardSnapshot extends CardSnapshot {
  readonly seat: number;
  /** Coberta de outro jogador: `covered: true` com carta vazia. */
  readonly covered: boolean;
}

export interface TrickSnapshot {
  readonly starter: number;
  readonly winnerSeat: number;
  readonly winnerTeam: number;
  readonly plays: readonly PlayedCardSnapshot[];
}

export interface PendingBetSnapshot {
  readonly fromSeat: number;
  readonly fromTeam: number;
  readonly toLevel: number;
}

export interface HandSnapshot {
  /** `''` quando a variante não usa vira. */
  readonly viraRank: string;
  readonly viraSuit: string;
  /** `normal` | `maoDeOnze` | `maoDeFerro` (ver `SpecialKind`). */
  readonly special: string;
  readonly specialTeam: number;
  /** `HandPhaseId` ou `''`. */
  readonly phase: string;
  readonly turn: number;
  readonly value: number;
  readonly level: number;
  readonly pending?: PendingBetSnapshot | undefined;
  readonly tricks: readonly TrickSnapshot[];
  readonly current: readonly PlayedCardSnapshot[];
}

export interface PlayerSnapshot {
  readonly seat: number;
  readonly nickname: string;
  /** JSON (texto) das partes do avatar. */
  readonly avatar: string;
  /** `PlayerStatusId`. */
  readonly status: string;
  readonly handSize: number;
  readonly isBot: boolean;
}

export interface OwnCoveredSnapshot extends CardSnapshot {
  /** Índice em `hand.tricks`, ou -1 se ainda em `hand.current`. */
  readonly trick: number;
}

/** Bloco privado do assento, enviado só ao dono. */
export interface SeatPrivateSnapshot {
  readonly seat: number;
  /** Vazio na mão de ferro (o dono só vê `handSize`). */
  readonly hand: readonly CardSnapshot[];
  /** Ids de `LegalActionId` (use `parseLegalAction`). */
  readonly legalActions: readonly string[];
  /** Mão de onze/dez: cartas do parceiro, só para a dupla que decide. */
  readonly partnerCards: readonly CardSnapshot[];
  readonly ownCovered: readonly OwnCoveredSnapshot[];
}

export interface TableStateSnapshot {
  readonly roomCode: string;
  readonly options: {
    readonly variant: string;
    readonly format: string;
    readonly ironHand: boolean;
    readonly visibility: string;
  };
  /** `TablePhase`. */
  readonly phase: string;
  readonly players: readonly PlayerSnapshot[];
  readonly series: {
    readonly format: string;
    readonly games: readonly number[];
    readonly gameNumber: number;
    /** -1 enquanto a série corre ou se foi cancelada. */
    readonly winnerTeam: number;
  };
  readonly game: {
    readonly scores: readonly number[];
    readonly handNumber: number;
    /** Assento do pé, -1 antes da primeira mão. */
    readonly pe: number;
  };
  readonly hand: HandSnapshot;
  /** Epoch ms em que o turno atual expira; 0 se não há prazo. */
  readonly turnDeadlineAt: number;
  /** Assentos que votaram para cancelar a mesa. */
  readonly cancelVotes: readonly number[];
  /** Chave = assento como string. O cliente recebe só a própria entrada. */
  readonly privates: { readonly [seat: string]: SeatPrivateSnapshot };
}

export function isTablePhase(x: unknown): x is TablePhase {
  return typeof x === 'string' && (TABLE_PHASES as readonly string[]).includes(x);
}

export function isHandPhaseId(x: unknown): x is HandPhaseId {
  return typeof x === 'string' && (HAND_PHASES as readonly string[]).includes(x);
}

export function isPlayerStatusId(x: unknown): x is PlayerStatusId {
  return typeof x === 'string' && (PLAYER_STATUSES as readonly string[]).includes(x);
}

// ---------------------------------------------------------------- ações legais

export type LegalActionId =
  | `play:${Rank}${Suit}`
  | `playCovered:${Rank}${Suit}`
  | `playBlind:${0 | 1 | 2}`
  | 'bet'
  | 'accept'
  | 'run'
  | 'specialPlay'
  | 'specialRun';

export type ParsedLegalAction =
  | { readonly kind: 'play'; readonly card: { readonly rank: Rank; readonly suit: Suit } }
  | { readonly kind: 'playCovered'; readonly card: { readonly rank: Rank; readonly suit: Suit } }
  | { readonly kind: 'playBlind'; readonly index: 0 | 1 | 2 }
  | { readonly kind: 'bet' | 'accept' | 'run' | 'specialPlay' | 'specialRun' };

const SIMPLE_ACTIONS = ['bet', 'accept', 'run', 'specialPlay', 'specialRun'] as const;

function parseCard(text: string): { rank: Rank; suit: Suit } | null {
  // Rank tem sempre 1 caractere; o resto é o naipe. Comparação exata contra as listas.
  const rank = RANKS.find((r) => r === text.slice(0, 1));
  const suit = SUITS.find((s) => s === text.slice(1));
  return rank === undefined || suit === undefined ? null : { rank, suit };
}

/**
 * Interpreta um id de ação legal do servidor. Estrito: qualquer coisa fora do formato (espaços,
 * maiúsculas trocadas, sufixos, `__proto__`, não-string) devolve `null`.
 */
export function parseLegalAction(id: unknown): ParsedLegalAction | null {
  if (typeof id !== 'string') return null;
  const simple = SIMPLE_ACTIONS.find((a) => a === id);
  if (simple !== undefined) return { kind: simple };
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const head = id.slice(0, colon);
  const tail = id.slice(colon + 1);
  if (head === 'play' || head === 'playCovered') {
    const card = parseCard(tail);
    return card === null ? null : { kind: head, card };
  }
  if (head === 'playBlind') {
    return tail === '0' || tail === '1' || tail === '2'
      ? { kind: 'playBlind', index: Number(tail) as 0 | 1 | 2 }
      : null;
  }
  return null;
}
