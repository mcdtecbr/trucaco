import { VARIANT_IDS, type VariantId } from './catalogs';

/** Assento na mesa: 0..seats-1. Duplas: assento % 2 (espelha `Seat` do motor). */
export type Seat = number;

/** Dupla: 0 (assentos pares) ou 1 (ímpares) (espelha `Team` do motor). */
export type Team = 0 | 1;

export const FORMATS = ['single', 'bo3'] as const;
export type Format = (typeof FORMATS)[number];

export const VISIBILITIES = ['public', 'private'] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export interface RoomOptions {
  readonly variant: VariantId;
  readonly format: Format;
  readonly ironHand: boolean;
  readonly visibility: Visibility;
}

export interface JoinOptions {
  /** Código da mesa privada. */
  readonly code?: string;
  /** Parceiro desejado na fila pública. */
  readonly partnerUserId?: string;
}

export const ROOM_CODE_LENGTH = 8;

/**
 * Alfabeto do código de mesa: A-Z e 2-9 sem os caracteres ambíguos 0, O, 1, I e L
 * (confundíveis ao ditar ou digitar). 26 - 3 letras (O, I, L) + 8 dígitos = 31 símbolos.
 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Verdadeiro se `code` é uma string de 8 caracteres do alfabeto (maiúsculas, sem normalizar). */
export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

export type RoomOptionsError = 'INVALID_OPTIONS' | 'BO3_REQUIRES_PRIVATE';

export type RoomOptionsResult =
  | { readonly ok: true; readonly options: RoomOptions }
  | { readonly ok: false; readonly error: RoomOptionsError };

/**
 * Valida opções de criação de mesa vindas do cliente. Campos extras são rejeitados.
 * Regra: série `bo3` só em mesa `private` (fila pública é sempre `single`).
 */
export function validateRoomOptions(raw: unknown): RoomOptionsResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'INVALID_OPTIONS' };
  }
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  const allowed = ['variant', 'format', 'ironHand', 'visibility'];
  if (keys.some((k) => !allowed.includes(k))) return { ok: false, error: 'INVALID_OPTIONS' };
  const { variant, format, ironHand, visibility } = o;
  if (
    !(VARIANT_IDS as readonly unknown[]).includes(variant) ||
    !(FORMATS as readonly unknown[]).includes(format) ||
    typeof ironHand !== 'boolean' ||
    !(VISIBILITIES as readonly unknown[]).includes(visibility)
  ) {
    return { ok: false, error: 'INVALID_OPTIONS' };
  }
  if (format === 'bo3' && visibility !== 'private') {
    return { ok: false, error: 'BO3_REQUIRES_PRIVATE' };
  }
  return {
    ok: true,
    options: {
      variant: variant as VariantId,
      format: format as Format,
      ironHand,
      visibility: visibility as Visibility,
    },
  };
}
