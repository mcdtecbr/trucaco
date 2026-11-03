import type { Card, Rank, Suit } from './cards';
import { RANKS, SUITS } from './cards';
import type { PublicGameEvent } from './events';
import type { ErrorCode } from './errors';
import type { Seat } from './room';
import {
  CHAT_MAX_COMBINING_RUN,
  CHAT_MAX_LENGTH,
  PARTNER_CODE_MAX_LENGTH,
  QUICK_PHRASE_IDS,
  SFX_IDS,
  SIGNAL_IDS,
  type QuickPhraseId,
  type SfxId,
  type SignalId,
} from './catalogs';

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
  | { readonly type: 'setCode'; readonly signalId: SignalId; readonly meaning: string }
  | { readonly type: 'voteCancel' }
  | { readonly type: 'voteRematch' }
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
  // Sem `message`: o cliente traduz pelo `code`. O servidor nunca repassa exceção/texto interno.
  | { readonly type: 'error'; readonly code: ErrorCode }
  // Combinado da dupla: SÓ para os 2 assentos do time. `by` = -1 quando carregado do banco.
  | {
      readonly type: 'codes';
      readonly codes: Readonly<Partial<Record<SignalId, string>>>;
      readonly by: Seat | -1;
      readonly at: number;
    }
  | { readonly type: 'presence'; readonly seat: Seat; readonly status: PresenceStatus }
  | { readonly type: 'turnTimer'; readonly seat: Seat; readonly deadlineAt: number };

export type ParseResult =
  | { readonly ok: true; readonly message: ClientMessage }
  | {
      readonly ok: false;
      readonly code: 'INVALID_PAYLOAD' | 'INVALID_SIGNAL' | 'INVALID_SFX' | 'CHAT_BLOCKED';
    };

const BAD: ParseResult = { ok: false, code: 'INVALID_PAYLOAD' };
const good = (message: ClientMessage): ParseResult => ({ ok: true, message });

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Copia as propriedades PRÓPRIAS enumeráveis para um objeto sem protótipo, lendo cada uma UMA vez
 * (getters não podem mudar de valor entre validação e uso; herdadas via protótipo são ignoradas).
 */
function snapshot(v: unknown): Record<string, unknown> | null {
  if (!isRecord(v)) return null;
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(v)) {
    if (!Object.hasOwn(v, k)) continue;
    out[k] = v[k];
  }
  return out;
}

/** Verdadeiro se o objeto só tem as chaves permitidas (rejeita campos extras, como `seat`). */
function onlyKeys(o: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(o).every((k) => allowed.includes(k));
}

function parseCard(v: unknown): Card | null {
  const c = snapshot(v);
  if (c === null || !onlyKeys(c, ['rank', 'suit'])) return null;
  const { rank, suit } = c;
  if (!(RANKS as readonly unknown[]).includes(rank)) return null;
  if (!(SUITS as readonly unknown[]).includes(suit)) return null;
  return { rank: rank as Rank, suit: suit as Suit };
}

/** String UTF-16 sem surrogate solto (`String.prototype.isWellFormed` é ES2024, fora do `lib`). */
function isWellFormed(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const CONTROL_OR_FORMAT = /^[\p{Cc}\p{Cf}\p{Co}\p{Cn}]$/u;
const COMBINING = /^\p{M}$/u;

/**
 * Limpa o texto de chat ou devolve `null` (rejeitar). Regras: teto de 280 unidades UTF-16 ANTES de
 * qualquer processamento; sem surrogate solto; NFC; `\n \r \t U+2028 U+2029` viram espaço; qualquer
 * controle/formatação (Cc, Cf: zero-width, bidi, BOM...), uso privado ou não atribuído é REJEITADO;
 * no máximo `CHAT_MAX_COMBINING_RUN` marcas combinantes seguidas; apara só as pontas; vazio é avaliado
 * depois da limpeza; limite de `CHAT_MAX_LENGTH` em code points depois do NFC.
 * Sem regex em string inteira (só testes de 1 caractere): linear, sem ReDoS.
 * O texto NÃO é escapado aqui (`<img onerror>` passa intacto): escapar/renderizar como texto puro é
 * responsabilidade do cliente.
 */
function cleanChatText(raw: string, max: number = CHAT_MAX_LENGTH): string | null {
  if (raw.length > max * 2) return null;
  if (!isWellFormed(raw)) return null;
  const text = raw.normalize('NFC');
  let out = '';
  let run = 0;
  let count = 0;
  for (const ch of text) {
    const ws = ch === '\n' || ch === '\r' || ch === '\t' || ch === '\u2028' || ch === '\u2029';
    const c = ws ? ' ' : ch;
    if (CONTROL_OR_FORMAT.test(c)) return null;
    run = COMBINING.test(c) ? run + 1 : 0;
    if (run > CHAT_MAX_COMBINING_RUN) return null;
    out += c;
    if (++count > max + 64) return null;
  }
  const trimmed = out.trim();
  if (trimmed.length === 0 || [...trimmed].length > max) return null;
  return trimmed;
}

/**
 * Porta de entrada anti-trapaça: valida estrutura, tipos, tamanhos e catálogos de uma mensagem
 * do cliente. Função pura, nunca lança (Proxy/getter hostil vira `INVALID_PAYLOAD`). Decisão: campos
 * extras são REJEITADOS (`INVALID_PAYLOAD`), em especial `seat`, que o servidor nunca aceita do
 * cliente. Só propriedades próprias contam e cada uma é lida uma vez. Não verifica legalidade de
 * jogo (isso é do motor). Exceção: chat de formato válido cujo TEXTO a limpeza recusa devolve
 * `CHAT_BLOCKED` (não é abuso; o servidor não expulsa por isso).
 */
export function parseClientMessage(raw: unknown): ParseResult {
  try {
    return parseUnsafe(raw);
  } catch {
    return BAD;
  }
}

function parseUnsafe(input: unknown): ParseResult {
  const raw = snapshot(input);
  if (raw === null) return BAD;
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
    case 'voteRematch':
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
    case 'setCode': {
      if (!onlyKeys(raw, ['type', 'signalId', 'meaning'])) return BAD;
      if (typeof raw.signalId !== 'string' || typeof raw.meaning !== 'string') return BAD;
      if (!(SIGNAL_IDS as readonly string[]).includes(raw.signalId)) return BAD;
      const signalId = raw.signalId as SignalId;
      // Vazio (só espaços) apaga o combinado; o resto passa pela mesma limpeza do chat, teto 60.
      if (raw.meaning.length <= PARTNER_CODE_MAX_LENGTH * 2 && raw.meaning.trim() === '') {
        return good({ type, signalId, meaning: '' });
      }
      const meaning = cleanChatText(raw.meaning, PARTNER_CODE_MAX_LENGTH);
      if (meaning === null) return { ok: false, code: 'CHAT_BLOCKED' };
      return good({ type, signalId, meaning });
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
      const text = cleanChatText(raw.text);
      // Formato válido, texto recusado pela limpeza (ZWJ, controle, bidi, longo, vazio): NÃO é abuso
      // de protocolo, então não é INVALID_PAYLOAD (o servidor não conta strike).
      if (text === null) return { ok: false, code: 'CHAT_BLOCKED' };
      return good({ type, scope, text });
    }
    default:
      return BAD;
  }
}
