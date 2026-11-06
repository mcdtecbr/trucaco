/**
 * Identidade dos bots de VAGA (mesa privada, escolhidos pelo host). Nome e avatar são sorteados daqui.
 *
 * O nome começa com "Bot " (com espaço): `NICKNAME_PATTERN` não aceita espaço em apelido de humano, então
 * nenhum jogador consegue se passar por bot nem colidir com estes nomes. O avatar sai do catálogo e passa
 * por `parseAvatarParts`. Aleatoriedade própria (`random`), nunca o RNG da partida.
 */
import {
  AVATAR_PART_COUNTS,
  AVATAR_PART_KEYS,
  HAIR_WITHOUT_HAT,
  VOICE_IDS,
  parseAvatarParts,
} from '@trucaco/protocol';

export const BOT_NAME_PREFIX = 'Bot ';

export const BOT_NAMES: readonly string[] = [
  'Zeca',
  'Tonico',
  'Dona Nena',
  'Chico',
  'Ritinha',
  'Juca',
  'Mariquinha',
  'Cabo Zé',
  'Bidu',
  'Tatá',
  'Neco',
  'Lalá',
];

export interface BotIdentity {
  readonly nickname: string;
  /** JSON das partes do avatar (mesmo formato do banco). */
  readonly avatar: string;
}

const pick = (n: number, random: () => number): number =>
  Math.min(n - 1, Math.max(0, Math.floor(random() * n)));

/** Sorteia um avatar válido do catálogo (cabelo sem chapéu respeitado). */
export function randomBotAvatar(random: () => number = Math.random): string {
  const parts: Record<string, number | string> = {};
  for (const key of AVATAR_PART_KEYS) parts[key] = pick(AVATAR_PART_COUNTS[key], random);
  if (HAIR_WITHOUT_HAT.includes(parts['hair'] as number)) parts['hat'] = 0;
  parts['voice'] = VOICE_IDS[pick(VOICE_IDS.length, random)] ?? VOICE_IDS[0];
  const valid = parseAvatarParts(parts);
  return JSON.stringify(valid ?? {});
}

/**
 * Sorteia nome e avatar, evitando os nomes em `taken` (os dos outros bots da mesa). Se todos os nomes da
 * lista estão em uso, acrescenta um número.
 */
export function pickBotIdentity(
  taken: ReadonlySet<string>,
  random: () => number = Math.random,
): BotIdentity {
  const free = BOT_NAMES.map((n) => BOT_NAME_PREFIX + n).filter((n) => !taken.has(n));
  const nickname =
    free.length > 0
      ? (free[pick(free.length, random)] ?? `${BOT_NAME_PREFIX}Zeca`)
      : `${BOT_NAME_PREFIX}${BOT_NAMES[pick(BOT_NAMES.length, random)] ?? 'Zeca'} ${taken.size + 1}`;
  return { nickname, avatar: randomBotAvatar(random) };
}
