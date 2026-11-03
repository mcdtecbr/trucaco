import { AVATAR_PART_COUNTS, type AvatarPartKey } from '@trucaco/protocol';

/**
 * Descrição em palavras de cada variante, na ORDEM DOS ÍNDICES (índice 0 = primeiro item), conforme o
 * `assets/rive/avatar.riv`, que é a referência visual (ADR 0003). Serve de rótulo no editor de avatar.
 * Os índices já estão gravados nos perfis: reordenar exige migração.
 */
export const PART_VARIANT_NAMES: Readonly<Record<AvatarPartKey, readonly string[]>> = {
  face_shape: ['oval', 'quadrado', 'triângulo', 'redondo'],
  skin: ['clara', 'dourada', 'morena', 'marrom', 'marrom escura', 'terrosa', 'oliva', 'rosada'],
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
  hair_color: [
    'castanho escuro',
    'preto',
    'castanho',
    'loiro',
    'ruivo',
    'grisalho',
    'azul',
    'rosa',
  ],
  eye_color: ['escuro', 'castanho', 'azul'],
  // Índice 0 = cor própria de cada modelo de roupa; 1..10 = cor escolhida (ver `resolveFill`).
  outfit_color: [
    'padrão da roupa',
    'rosa',
    'azul claro',
    'marrom',
    'grafite',
    'branco',
    'preto',
    'azul',
    'vermelho',
    'verde',
    'amarelo',
  ],
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
  { base: '#C9A56B', shade: '#A07E45' },
  { base: '#F1C2AE', shade: '#D49A84' },
];

/** Cores de cabelo, sobrancelha e bigode (input `hair_color`). Boné e chapéu não mudam. */
export const HAIR_COLORS: readonly string[] = [
  '#2B1B12',
  '#14110F',
  '#5A3A22',
  '#E3C16F',
  '#B7461B',
  '#A9ADB3',
  '#2B6CB0',
  '#D64C8F',
];

/** Cor padrão do cabelo (índice 0). Mantida por compatibilidade. */
export const HAIR_COLOR = HAIR_COLORS[0]!;

/** Cores da íris/pupila (input `eye_color`). */
export const EYE_COLORS: readonly string[] = ['#1B1B1F', '#6B3F1F', '#2B72C9'];

/**
 * Cores da roupa (input `outfit_color`). Índices 0..5 são as cores próprias dos 6 modelos (o modelo `n` usa
 * `OUTFIT_COLORS[n]`); 6..10 são cores extras. `outfit_color` 0 = "padrão do modelo" (ver `resolveFill`).
 */
export const OUTFIT_COLORS: readonly string[] = [
  '#E5E7EB',
  '#F2A0A0',
  '#0EA5E9',
  '#7C2D12',
  '#1F2937',
  '#F9FAFB',
  '#111827',
  '#1D4ED8',
  '#B91C1C',
  '#15803D',
  '#FACC15',
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
