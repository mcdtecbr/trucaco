import { DEFAULT_AVATAR_PARTS, parseAvatarParts } from '@trucaco/protocol';
import type { AvatarParts, VoiceId } from '@trucaco/protocol';

/** Avatar a editar a partir do `GET /me` (`null` ou inválido = o padrão). */
export function initialAvatar(fromServer: unknown): AvatarParts {
  return parseAvatarParts(fromServer) ?? DEFAULT_AVATAR_PARTS;
}

/** Voz do avatar quando nenhuma foi escolhida (a mesma que a mesa usa: `speechDirector`). */
export const DEFAULT_EDITOR_VOICE: VoiceId = 'masc_1';

export function voiceOf(parts: AvatarParts): VoiceId {
  return parts.voice ?? DEFAULT_EDITOR_VOICE;
}

/** Troca só a voz. As 15 partes numéricas e a chave `voice` seguem juntas no que vai ao `PUT /me/avatar`. */
export function applyVoice(cur: AvatarParts, voice: VoiceId): AvatarParts {
  return { ...cur, voice };
}

function canonical(p: AvatarParts): string {
  return JSON.stringify(Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** Igualdade por conteúdo, sem depender da ordem das chaves (detecta "há mudança não salva"). */
export function samePartsAs(a: AvatarParts, b: AvatarParts): boolean {
  return canonical(a) === canonical(b);
}
