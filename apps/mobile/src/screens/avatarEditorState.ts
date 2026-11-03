import { DEFAULT_AVATAR_PARTS, parseAvatarParts } from '@trucaco/protocol';
import type { AvatarParts } from '@trucaco/protocol';

/** Avatar a editar a partir do `GET /me` (`null` ou inválido = o padrão). */
export function initialAvatar(fromServer: unknown): AvatarParts {
  return parseAvatarParts(fromServer) ?? DEFAULT_AVATAR_PARTS;
}

/** Igualdade por conteúdo (detecta "há mudança não salva"). */
export function samePartsAs(a: AvatarParts, b: AvatarParts): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
