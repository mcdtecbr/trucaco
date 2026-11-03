import { AVATAR_PART_COUNTS, type AvatarPartKey } from '@trucaco/protocol';

/**
 * Descrição em palavras de cada variante, na ORDEM DOS ÍNDICES (índice 0 = primeiro item), conforme o
 * `assets/rive/avatar.riv`, que é a referência visual (ADR 0003). Serve de rótulo no editor de avatar.
 * Os índices já estão gravados nos perfis: reordenar exige migração.
 */
export const PART_VARIANT_NAMES: Readonly<Record<AvatarPartKey, readonly string[]>> = {
  face_shape: ['oval', 'quadrado', 'triângulo', 'redondo'],
  skin: ['clara', 'dourada', 'morena', 'marrom', 'marrom escura', 'terrosa'],
  hair: ['careca', 'curto', 'afro', 'longo', 'coque', 'boné', 'chapéu', 'topete'],
  eyes: ['normal', 'sonolento', 'grande', 'pequeno'],
  mouth: ['sorriso suave', 'sorriso largo', 'aberta', 'pequena'],
  outfit: [
    'camiseta cinza',
    'camiseta rosa gola V',
    'polo azul',
    'camisa marrom de botões',
    'colete sobre camisa branca',
    'regata branca',
  ],
  accessory: ['nenhum', 'bigode', 'brinco'],
  bg_color: ['verde', 'azul', 'vermelho', 'laranja', 'cinza', 'roxo', 'laranja escuro', 'turquesa'],
};

/** Cor base e de sombra de cada pele, na ordem do input `skin` do rig. */
export interface SkinColor {
  readonly base: string;
  readonly shade: string;
}

export const SKIN_COLORS: readonly SkinColor[] = [
  { base: '#FCE4D6', shade: '#E8B89B' },
  { base: '#E0AC69', shade: '#C68943' },
  { base: '#B87B42', shade: '#945927' },
  { base: '#8D5524', shade: '#673B15' },
  { base: '#523219', shade: '#361F0E' },
  { base: '#C67D5A', shade: '#A15538' },
];

/** O rig tem uma única cor de cabelo; o estilo é a variante de `hair`. */
export const HAIR_COLOR = '#2B1B12';

/** Cor principal de cada roupa (rótulo/UI; o desenho completo vem de `art.ts`). */
export const OUTFIT_COLORS: readonly string[] = [
  '#E5E7EB',
  '#F2A0A0',
  '#0EA5E9',
  '#7C2D12',
  '#1F2937',
  '#F9FAFB',
];

export const BG_COLORS: readonly string[] = [
  '#1E5631',
  '#1D4ED8',
  '#991B1B',
  '#D97706',
  '#4B5563',
  '#581C87',
  '#C2410C',
  '#0F766E',
];

/** Índice seguro: inteiro dentro de `0..count-1`, senão 0. Nunca lança. */
export function safeIndex(key: AvatarPartKey, value: unknown): number {
  const max = AVATAR_PART_COUNTS[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max
    ? value
    : 0;
}
