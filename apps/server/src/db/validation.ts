import { InvalidInputError, type PartnerCodesMap } from './types';

export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 16;
export const PARTNER_CODE_MAX = 140;
export const REPORT_TEXT_MAX = 500;

/** Conta code points, como o `char_length` do Postgres. */
function length(text: string): number {
  return [...text].length;
}

export function assertNickname(nickname: string): void {
  const n = length(nickname);
  if (n < NICKNAME_MIN || n > NICKNAME_MAX || nickname !== nickname.trim()) {
    throw new InvalidInputError(`Apelido deve ter ${NICKNAME_MIN} a ${NICKNAME_MAX} caracteres.`);
  }
}

export function assertReportText(text: string | undefined): void {
  if (text !== undefined && length(text) > REPORT_TEXT_MAX) {
    throw new InvalidInputError(`Texto da denúncia passa de ${REPORT_TEXT_MAX} caracteres.`);
  }
}

export function assertPartnerCodes(codes: PartnerCodesMap): void {
  for (const [signalId, meaning] of Object.entries(codes)) {
    if (signalId === '' || length(meaning) > PARTNER_CODE_MAX) {
      throw new InvalidInputError(`Código inválido (máximo ${PARTNER_CODE_MAX} caracteres).`);
    }
  }
}

/**
 * Forma canônica do par para `partner_codes`: menor id primeiro, comparando a string UUID em
 * minúsculas (mesma ordem de bytes do tipo `uuid` do Postgres, que o CHECK usa).
 */
export function orderPair(x: string, y: string): readonly [string, string] {
  const a = x.toLowerCase();
  const b = y.toLowerCase();
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function decodeCursor(raw: string): MatchCursor {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [iso, id, ...rest] = text.split('|');
  const endedAt = iso === undefined ? new Date(NaN) : new Date(iso);
  if (rest.length > 0 || id === undefined || !UUID_RE.test(id) || Number.isNaN(endedAt.getTime())) {
    throw new InvalidInputError('Cursor inválido.');
  }
  return { endedAt, id };
}
