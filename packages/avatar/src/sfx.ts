import { SFX_IDS, type SfxId } from '@trucaco/protocol';

export interface SoundboardSfxInfo {
  readonly id: SfxId;
  readonly label: string;
  readonly icon: string;
}

/** Efeitos engraçados do painel (ids do protocolo, docs/audio.md §2). */
export const SOUNDBOARD_SFX: readonly SoundboardSfxInfo[] = [
  { id: 'horn', label: 'Buzina', icon: '📯' },
  { id: 'sad_trombone', label: 'Trombone triste', icon: '🎺' },
  { id: 'laugh', label: 'Risada', icon: '😂' },
  { id: 'crowd_ooh', label: 'Torcida "uuuh"', icon: '😮' },
  { id: 'rooster', label: 'Galo', icon: '🐓' },
  { id: 'rimshot', label: 'Ba-dum-tss', icon: '🥁' },
  { id: 'clap', label: 'Palmas', icon: '👏' },
  { id: 'crickets', label: 'Grilos', icon: '🦗' },
];

/** Efeitos de jogo, só locais: não passam pelo servidor nem entram em `SFX_IDS`. */
export const GAME_SFX_IDS = ['card_play', 'card_shuffle', 'table_slam', 'ambience_bar'] as const;
export type GameSfxId = (typeof GAME_SFX_IDS)[number];

export const GAME_SFX_LABELS: Readonly<Record<GameSfxId, string>> = {
  card_play: 'Carta na mesa',
  card_shuffle: 'Embaralhar',
  /** Soco na mesa quando alguém pede truco ou aumenta. */
  table_slam: 'Soco na mesa',
  /** Opcional: ambiente de bar em loop, desligável nas configurações. */
  ambience_bar: 'Ambiente de bar',
};

export type AnySfxId = SfxId | GameSfxId;

export const ALL_SFX_IDS: readonly AnySfxId[] = [...SFX_IDS, ...GAME_SFX_IDS];

export function soundboardInfo(id: SfxId): SoundboardSfxInfo {
  const s = SOUNDBOARD_SFX.find((x) => x.id === id);
  if (s === undefined) throw new Error(`efeito desconhecido: ${id}`);
  return s;
}

/** Caminho relativo a `assets/audio` do efeito. */
export function sfxPath(id: AnySfxId): string {
  return `sfx/${id}.m4a`;
}
