/**
 * Catálogo de partes do avatar (Fase 4). Contrato entre servidor (valida `PUT /me/avatar`), cliente
 * (editor e `<Avatar>`) e o rig Rive (cada chave é um input numérico da state machine).
 * Só tipos, constantes e uma função pura; sem rede.
 */

/** Partes trocáveis do avatar, na ordem em que aparecem no rig. */
export const AVATAR_PART_KEYS = [
  'face_shape',
  'skin',
  'hair',
  'eyes',
  'mouth',
  'outfit',
  'accessory',
  'bg_color',
] as const;
export type AvatarPartKey = (typeof AVATAR_PART_KEYS)[number];

/** Variantes por parte (índices `0..n-1`). Só cresce: reduzir invalidaria avatares já gravados. */
export const AVATAR_PART_COUNTS: Readonly<Record<AvatarPartKey, number>> = {
  face_shape: 4,
  skin: 6,
  hair: 8,
  eyes: 4,
  mouth: 4,
  outfit: 6,
  accessory: 5,
  bg_color: 8,
};

/** Vozes do avatar (usadas na Fase 5b; já reservadas no contrato). */
export const VOICE_IDS = ['masc_1', 'masc_2', 'masc_3', 'fem_1', 'fem_2', 'fem_3'] as const;
export type VoiceId = (typeof VOICE_IDS)[number];

export interface AvatarParts {
  readonly face_shape: number;
  readonly skin: number;
  readonly hair: number;
  readonly eyes: number;
  readonly mouth: number;
  readonly outfit: number;
  readonly accessory: number;
  readonly bg_color: number;
  readonly voice?: VoiceId;
}

/** Avatar de quem ainda não escolheu (ou cujo avatar gravado é inválido). Todas as partes no índice 0. */
export const DEFAULT_AVATAR_PARTS: AvatarParts = {
  face_shape: 0,
  skin: 0,
  hair: 0,
  eyes: 0,
  mouth: 0,
  outfit: 0,
  accessory: 0,
  bg_color: 0,
};

const KEY_SET: ReadonlySet<string> = new Set([...AVATAR_PART_KEYS, 'voice']);

/**
 * Valida e devolve uma cópia canônica das partes, ou `null`. Aceita só objeto plano com EXATAMENTE as
 * chaves de `AVATAR_PART_KEYS` (inteiros em `0..n-1`) e, opcionalmente, `voice` do catálogo. Chave
 * extra, parte faltando, índice fora do intervalo, tipo errado ou protótipo estranho -> `null`.
 */
export function parseAvatarParts(raw: unknown): AvatarParts | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const proto: unknown = Object.getPrototypeOf(raw);
  if (proto !== Object.prototype && proto !== null) return null;
  const rec = raw as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!KEY_SET.has(key)) return null;
  }
  const out: Record<string, number | VoiceId> = {};
  for (const key of AVATAR_PART_KEYS) {
    if (!Object.hasOwn(rec, key)) return null;
    const v = rec[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v >= AVATAR_PART_COUNTS[key]) {
      return null;
    }
    out[key] = v;
  }
  if (Object.hasOwn(rec, 'voice')) {
    const voice = rec['voice'];
    if (typeof voice !== 'string' || !(VOICE_IDS as readonly string[]).includes(voice)) return null;
    out['voice'] = voice as VoiceId;
  }
  return out as unknown as AvatarParts;
}
