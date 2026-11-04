import { VOICE_IDS, type VoiceId } from '@trucaco/protocol';
import catalog from './audioCatalog.json';

export type VoiceGroup = 'masc' | 'fem';

export interface VoiceInfo {
  readonly id: VoiceId;
  readonly group: VoiceGroup;
  /** Rótulo para o criador de avatar. */
  readonly label: string;
  /** Há arquivos de áudio desta voz no repositório (protótipo: só `masc_1` e `fem_1`). */
  readonly hasFiles: boolean;
}

const WITH_FILES = new Set<string>(catalog.voicesWithFiles);

function groupOf(id: VoiceId): VoiceGroup {
  return id.startsWith('fem') ? 'fem' : 'masc';
}

function labelOf(id: VoiceId): string {
  const n = id.slice(id.lastIndexOf('_') + 1);
  return `${groupOf(id) === 'fem' ? 'Feminina' : 'Masculina'} ${n}`;
}

/** Todas as vozes declaradas, na ordem de `VOICE_IDS`. */
export const VOICES: readonly VoiceInfo[] = VOICE_IDS.map((id) => ({
  id,
  group: groupOf(id),
  label: labelOf(id),
  hasFiles: WITH_FILES.has(id),
}));

export const VOICES_WITH_FILES: readonly VoiceId[] = VOICES.filter((v) => v.hasFiles).map(
  (v) => v.id,
);

export function voiceInfo(id: VoiceId): VoiceInfo {
  const v = VOICES.find((x) => x.id === id);
  if (v === undefined) throw new Error(`voz desconhecida: ${id}`);
  return v;
}

/**
 * Voz que de fato toca: a própria, se tem arquivos; senão a primeira do mesmo grupo que tem;
 * senão `null` (o cliente mostra só a legenda).
 */
export function resolveVoice(
  id: VoiceId,
  available: readonly VoiceId[] = VOICES_WITH_FILES,
): VoiceId | null {
  if (available.includes(id)) return id;
  const group = groupOf(id);
  return available.find((v) => groupOf(v) === group) ?? null;
}

/** Caminho relativo a `assets/audio` do take de uma voz. */
export function voiceTakePath(voice: VoiceId, takeId: string): string {
  return `voices/${voice}/${takeId}.m4a`;
}
