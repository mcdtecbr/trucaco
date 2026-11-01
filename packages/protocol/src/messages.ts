import type { Card, Rank, Suit } from './cards';
import { RANKS, SUITS } from './cards';
import type { PublicGameEvent } from './events';
import type { ErrorCode } from './errors';
import type { Seat } from './room';
import {
  CHAT_MAX_LENGTH,
  QUICK_PHRASE_IDS,
  SFX_IDS,
  SIGNAL_IDS,
  type QuickPhraseId,
  type SfxId,
  type SignalId,
} from './index';

export type ChatScope = 'partner' | 'table';

/** Cliente -> servidor. NUNCA carrega `seat`: o servidor deriva do `client`. */
export type ClientMessage =
  | { readonly type: 'play'; readonly card: Card; readonly covered?: boolean }
  | { readonly type: 'playBlind'; readonly index: number }
  | { readonly type: 'bet' }
  | { readonly type: 'accept' }
  | { readonly type: 'run' }
  | { readonly type: 'special'; readonly decision: 'play' | 'run' }
  | { readonly type: 'signal'; readonly signalId: SignalId }
  | { readonly type: 'sfx'; readonly sfxId: SfxId }
  | { readonly type: 'chat'; readonly scope: ChatScope; readonly text: string }
  | { readonly type: 'chat'; readonly scope: ChatScope; readonly phraseId: QuickPhraseId }
  | { readonly type: 'voteCancel' }
  | { readonly type: 'ready' };

export type PresenceStatus = 'online' | 'away' | 'bot';

/** Servidor -> cliente. */
export type ServerMessage =
  | {
      readonly type: 'event';
      readonly seq: number;
      readonly at: number;
      readonly event: PublicGameEvent;
    }
  | {
      readonly type: 'signal';
      readonly seat: Seat;
      readonly signalId: SignalId;
      readonly at: number;
    }
  | { readonly type: 'sfx'; readonly seat: Seat; readonly sfxId: SfxId; readonly at: number }
  | {
      readonly type: 'chat';
      readonly scope: ChatScope;
      readonly seat: Seat;
      readonly text: string;
      readonly at: number;
    }
  | {
      readonly type: 'chat';
      readonly scope: ChatScope;
      readonly seat: Seat;
      readonly phraseId: QuickPhraseId;
      readonly at: number;
    }
  | { readonly type: 'error'; readonly code: ErrorCode; readonly message?: string }
  | { readonly type: 'presence'; readonly seat: Seat; readonly status: PresenceStatus }
  | { readonly type: 'turnTimer'; readonly seat: Seat; readonly deadlineAt: number };

export type ParseResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | { readonly ok: false; readonly code: 'INVALID_PAYLOAD' | 'INVALID_SIGNAL' | 'INVALID_SFX' };

const BAD: ParseResult = { ok: false, code: 'INVALID_PAYLOAD' };
const good = (message: ClientMessage): ParseResult => ({ ok: true, message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Verdadeiro se o objeto só tem as chaves permitidas (rejeita campos extras, como `seat`). */
function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

function parseCard(v: unknown): Card | null {
  if (!isRecord(v) || !onlyKeys(v, ['rank', 'suit'])) return null;
  const { rank, suit } = v;
  if (!(RANKS as readonly unknown[]).includes(rank)) return null;
  if (!(SUITS as readonly unknown[]).includes(suit)) return null;
  return { rank: rank as Rank, suit: suit as Suit };
}

/**
 * Porta de entrada anti-trapaça: valida estrutura, tipos, tamanhos e catálogos de uma mensagem
 * do cliente. Função pura, nunca lança. Decisão: campos extras são REJEITADOS (`INVALID_PAYLOAD`),
 * em especial `seat`, que o servidor nunca aceita do cliente. Só `type` e os campos de cada
 * mensagem são permitidos. Não verifica legalidade de jogo (isso é do motor).
 */
export function parseClientMessage(raw: unknown): ParseResult {
  if (!isRecord(raw)) return BAD;
  const type = raw.type;
  if (typeof type !== 'string') return BAD;

  switch (type) {
    case 'play': {
      if (!onlyKeys(raw, ['type', 'card', 'covered'])) return BAD;
      const card = parseCard(raw.card);
      if (card === null) return BAD;
      if (raw.covered === undefined) return good({ type, card });
      if (typeof raw.covered !== 'boolean') return BAD;
      return good({ type, card, covered: raw.covered });
    }
    case 'playBlind': {
      if (!onlyKeys(raw, ['type', 'index'])) return BAD;
      const { index } = raw;
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 2) {
        return BAD;
      }
      return good({ type, index });
    }
    case 'bet':
    case 'accept':
    case 'run':
    case 'voteCancel':
    case 'ready':
      return onlyKeys(raw, ['type']) ? good({ type }) : BAD;
    case 'special': {
      if (!onlyKeys(raw, ['type', 'decision'])) return BAD;
      const { decision } = raw;
      return decision === 'play' || decision === 'run' ? good({ type, decision }) : BAD;
    }
    case 'signal': {
      if (!onlyKeys(raw, ['type', 'signalId']) || typeof raw.signalId !== 'string') return BAD;
      if (!(SIGNAL_IDS as readonly string[]).includes(raw.signalId)) {
        return { ok: false, code: 'INVALID_SIGNAL' };
      }
      return good({ type, signalId: raw.signalId as SignalId });
    }
    case 'sfx': {
      if (!onlyKeys(raw, ['type', 'sfxId']) || typeof raw.sfxId !== 'string') return BAD;
      if (!(SFX_IDS as readonly string[]).includes(raw.sfxId)) {
        return { ok: false, code: 'INVALID_SFX' };
      }
      return good({ type, sfxId: raw.sfxId as SfxId });
    }
    case 'chat': {
      const { scope } = raw;
      if (scope !== 'partner' && scope !== 'table') return BAD;
      if ('text' in raw && 'phraseId' in raw) return BAD;
      if ('phraseId' in raw) {
        if (!onlyKeys(raw, ['type', 'scope', 'phraseId'])) return BAD;
        const { phraseId } = raw;
        if (
          typeof phraseId !== 'string' ||
          !(QUICK_PHRASE_IDS as readonly string[]).includes(phraseId)
        ) {
          return BAD;
        }
        return good({ type, scope, phraseId: phraseId as QuickPhraseId });
      }
      if (!onlyKeys(raw, ['type', 'scope', 'text']) || typeof raw.text !== 'string') return BAD;
      // Limite em code points; teto bruto em code units evita varrer strings gigantes.
      if (raw.text.length > CHAT_MAX_LENGTH * 2) return BAD;
      const text = raw.text.trim();
      if (text.length === 0 || [...text].length > CHAT_MAX_LENGTH) return BAD;
      return good({ type, scope, text });
    }
    default:
      return BAD;
  }
}
