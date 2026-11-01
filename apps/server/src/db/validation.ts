import { CHAT_MAX_LENGTH, SIGNAL_IDS } from '@trucaco/protocol';
import {
  InvalidInputError,
  type FinishedMatchInput,
  type JsonObject,
  type PartnerCodesMap,
} from './types';

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const PARTNER_CODE_MAX = CHAT_MAX_LENGTH;
export const REPORT_TEXT_MAX = 500;
/** Chaves de `AvatarParts` (tamanho dos valores: `PARTNER_CODE_MAX`). Subir aqui se o rig crescer. */
export const AVATAR_PARTS_MAX_KEYS = 32;
export const UINT32_MAX = 4294967295;
/** Tetos de tamanho (bytes de JSON) por coluna; os mesmos valores dos CHECKs `*_size_check`. */
export const JSON_LIMITS = {
  options: 16384,
  games: 65536,
  deals: 1048576,
  events: 2097152,
} as const;

function assertJsonSize(value: unknown, limit: number): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') >= limit) {
    throw new InvalidInputError('Conteúdo da partida grande demais.');
  }
}

/** Conta code points, como o `char_length` do Postgres. */
function length(text: string): number {
  return [...text].length;
}

/**
 * Política de apelido (espelha `users_nickname_nfc_check` e `users_nickname_charset_check`):
 * NFC; letras latinas (Latin-1 e Latin Extended-A/B, sem × e ÷), dígitos, `_`, `.` e `-`;
 * 3 a 16 code points. Sem espaço, tab, controle, zero-width, bidi nem outros alfabetos.
 */
export const NICKNAME_PATTERN = /^[0-9A-Za-z_.\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F-]+$/;

/** Forma canônica do apelido (NFC). Deve ser aplicada ANTES de validar e de gravar. */
export function normalizeNickname(raw: string): string {
  return raw.normalize('NFC');
}

/** Normaliza (NFC), valida e devolve o apelido a gravar. Lança `InvalidInputError`. */
export function validateNickname(raw: string): string {
  const nickname = normalizeNickname(raw);
  const n = length(nickname);
  if (n < NICKNAME_MIN || n > NICKNAME_MAX || !NICKNAME_PATTERN.test(nickname)) {
    throw new InvalidInputError(
      `Apelido deve ter ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres: letras latinas, números, "_", "." ou "-".`,
    );
  }
  return nickname;
}

export function assertProviderSubject(subject: string): void {
  const n = length(subject);
  if (n < 1 || n > 255 || subject.includes('\u0000')) {
    throw new InvalidInputError('Identificador do provedor inválido.');
  }
}

export function assertReportText(text: string | undefined): void {
  if (text !== undefined && length(text) > REPORT_TEXT_MAX) {
    throw new InvalidInputError(`Texto da denúncia passa de ${REPORT_TEXT_MAX} caracteres.`);
  }
}

const SIGNAL_ID_SET: ReadonlySet<string> = new Set(SIGNAL_IDS);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `signalId` só do catálogo, no máximo um significado por sinal, cada um com até 140 caracteres. */
export function assertPartnerCodes(codes: PartnerCodesMap): void {
  if (!isPlainObject(codes)) throw new InvalidInputError('Códigos inválidos.');
  const entries = Object.entries(codes);
  if (entries.length > SIGNAL_IDS.length) throw new InvalidInputError('Códigos demais.');
  for (const [signalId, meaning] of entries) {
    if (!SIGNAL_ID_SET.has(signalId)) throw new InvalidInputError('Sinal desconhecido.');
    if (typeof meaning !== 'string' || length(meaning) > PARTNER_CODE_MAX) {
      throw new InvalidInputError(`Código inválido (máximo ${PARTNER_CODE_MAX} caracteres).`);
    }
  }
}

/** Objeto plano com poucas chaves e valores escalares curtos (strings até 140 caracteres). */
export function assertAvatarParts(parts: JsonObject): void {
  if (!isPlainObject(parts)) throw new InvalidInputError('Avatar inválido.');
  const entries = Object.entries(parts);
  if (entries.length > AVATAR_PARTS_MAX_KEYS)
    throw new InvalidInputError('Avatar com partes demais.');
  for (const [key, value] of entries) {
    const scalar =
      value === null ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'string';
    if (
      key === '' ||
      length(key) > PARTNER_CODE_MAX ||
      !scalar ||
      (typeof value === 'string' && length(value) > PARTNER_CODE_MAX)
    ) {
      throw new InvalidInputError('Avatar inválido.');
    }
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Valida e normaliza (minúsculas) um id de entrada. Qualquer não-UUID vira `InvalidInputError`. */
export function normalizeId(id: unknown): string {
  if (typeof id !== 'string') throw new InvalidInputError('Identificador inválido.');
  const lower = id.toLowerCase();
  if (!UUID_RE.test(lower)) throw new InvalidInputError('Identificador inválido.');
  return lower;
}

/**
 * Regras de `matches`/`match_players` que o banco recusa por CHECK/FK, aplicadas antes de gravar
 * (as duas implementações). Devolve o input com os `userId` normalizados.
 */
export function assertFinishedMatch(input: FinishedMatchInput): FinishedMatchInput {
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > UINT32_MAX) {
    throw new InvalidInputError('Semente fora de uint32.');
  }
  if (
    !(input.startedAt instanceof Date) ||
    !(input.endedAt instanceof Date) ||
    Number.isNaN(input.startedAt.getTime()) ||
    Number.isNaN(input.endedAt.getTime()) ||
    input.startedAt.getTime() > input.endedAt.getTime()
  ) {
    throw new InvalidInputError('Período da partida inválido.');
  }
  if ((input.status === 'finished') !== (input.winnerTeam === 0 || input.winnerTeam === 1)) {
    throw new InvalidInputError('Vencedor incoerente com o status.');
  }
  if (input.winnerTeam !== null && input.winnerTeam !== 0 && input.winnerTeam !== 1) {
    throw new InvalidInputError('Vencedor inválido.');
  }
  if (input.roomCode !== null && length(input.roomCode) > 8) {
    throw new InvalidInputError('Código de sala inválido.');
  }
  assertJsonSize(input.options, JSON_LIMITS.options);
  assertJsonSize(input.games, JSON_LIMITS.games);
  assertJsonSize(input.events, JSON_LIMITS.events);
  if (input.deals !== null) assertJsonSize(input.deals, JSON_LIMITS.deals);
  const seats = new Set<number>();
  const players = input.players.map((p) => {
    if (!Number.isInteger(p.seat) || p.seat < 0 || p.seat > 3) {
      throw new InvalidInputError('Assento fora de 0..3.');
    }
    if (p.team !== p.seat % 2) throw new InvalidInputError('Dupla incoerente com o assento.');
    if (seats.has(p.seat)) throw new InvalidInputError('Assento repetido.');
    seats.add(p.seat);
    if (p.botFrom !== null && (!Number.isInteger(p.botFrom) || p.botFrom < 0)) {
      throw new InvalidInputError('botFrom inválido.');
    }
    return { ...p, userId: p.userId === null ? null : normalizeId(p.userId) };
  });
  return { ...input, players };
}

/**
 * Forma canônica do par para `partner_codes`: menor id primeiro, comparando a string UUID em
 * minúsculas (mesma ordem de bytes do tipo `uuid` do Postgres, que o CHECK usa).
 */
export function orderPair(x: string, y: string): readonly [string, string] {
  const a = normalizeId(x);
  const b = normalizeId(y);
  if (a === b) throw new InvalidInputError('Um usuário não forma par consigo mesmo.');
  return a < b ? [a, b] : [b, a];
}

export function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1) throw new InvalidInputError('limit inválido.');
  return Math.min(limit, max);
}

export interface MatchCursor {
  readonly endedAt: Date;
  readonly id: string;
}

export function encodeCursor(cursor: MatchCursor): string {
  return Buffer.from(`${cursor.endedAt.toISOString()}|${cursor.id}`, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): MatchCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [iso, id, ...rest] = text.split('|');
  const endedAt = iso === undefined ? new Date(NaN) : new Date(iso);
  if (rest.length > 0 || id === undefined || !UUID_RE.test(id) || Number.isNaN(endedAt.getTime())) {
    throw new InvalidInputError('Cursor inválido.');
  }
  return { endedAt, id };
}
