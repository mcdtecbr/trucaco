/**
 * Partes do avatar a partir do `player.avatar` do estado (string JSON). Tolerante: vazio, JSON inválido ou
 * partes fora do catálogo caem em `DEFAULT_AVATAR_PARTS`. O resultado é CACHEADO por texto: o mesmo texto
 * devolve o MESMO objeto, para o `<Avatar>` (memoizado) não re-renderizar a cada patch do estado.
 */
import { DEFAULT_AVATAR_PARTS, parseAvatarParts } from '@trucaco/protocol';
import type { AvatarParts } from '@trucaco/protocol';

const MAX_CACHE = 64;
const cache = new Map<string, AvatarParts>();

export function avatarPartsOf(raw: unknown): AvatarParts {
  if (typeof raw !== 'string' || raw === '') return DEFAULT_AVATAR_PARTS;
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  let parts: AvatarParts | null = null;
  try {
    parts = parseAvatarParts(JSON.parse(raw));
  } catch {
    parts = null;
  }
  const value = parts ?? DEFAULT_AVATAR_PARTS;
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(raw, value);
  return value;
}
