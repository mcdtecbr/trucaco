import { AVATAR_PART_COUNTS, type AvatarPartKey } from '@trucaco/protocol';

/**
 * Descrição em palavras de cada variante, na ORDEM DOS ÍNDICES (índice 0 = primeiro item), conforme o
 * `assets/rive/avatar.riv`, que é a referência visual (ADR 0003). Serve de rótulo no editor de avatar.
 * Os índices já estão gravados nos perfis: reordenar exige migração.
 */
export const PART_VARIANT_NAMES: Readonly<Record<AvatarPartKey, readonly string[]>> = {
  // Fatia 3: os 6 formatos da 1ª linha da prancha de referência, da esquerda para a direita.
  face_shape: ['oval alto', 'redondo', 'quadrado', 'coração', 'queixo em V', 'longo'],
  skin: ['clara', 'dourada', 'morena', 'marrom', 'marrom escura', 'terrosa', 'oliva', 'rosada'],
  // Fatia 4: 19 formatos na ordem das pranchas (esquerda para a direita, cima para baixo), sem as
  // repetições que só mudam de cor (a cor vem de `hair_color`). Boné e chapéu saíram de `hair` (ver `hat`).
  hair: [
    'careca',
    'espetado',
    'longo ondulado',
    'cacheado',
    'coque alto',
    'longo com franja',
    'ondulado médio',
    'topete lateral',
    'afro',
    'pixie',
    'repicado',
    'bob de lado',
    'longo de lado',
    'ondulado curto',
    'longo liso',
    'bob repicado',
    'coque',
    'bob com franja',
    'raspado',
  ],
  // Fatia 3: estilos da prancha de referência, de cima para baixo.
  eyes: [
    'amendoado com delineador',
    'aberto com pálpebra marcada',
    'redondo liso',
    'arregalado com cílios',
    'grande com brilho',
    'cílios longos',
  ],
  brows: ['arco grosso', 'inclinada para baixo', 'inclinada para cima', 'arco fino'],
  // Os 8 primeiros narizes de frente das duas fileiras da prancha (esquerda, depois direita).
  nose: [
    'ponta redonda',
    'fino e pontudo',
    'ponte larga',
    'topo reto',
    'topo largo',
    'bulbo grande',
    'largo e robusto',
    'pequeno',
  ],
  // 0..3 mantêm o lugar (o visual de quem já salvou continua parecido); 4 é nova (cresceu de 4 para 5).
  mouth: [
    'sorriso discreto',
    'sorriso largo',
    'lábios cheios entreabertos',
    'lábios fechados',
    'lábios cheios',
  ],
  outfit: [
    'camiseta cinza',
    'camiseta rosa gola V',
    'polo azul',
    'camisa marrom de botões',
    'colete sobre camisa branca',
    'regata branca',
  ],
  accessory: ['nenhum', 'bigode', 'brinco'],
  // Fatia 4: barbas (cor = `hair_color`) e chapéus (cada um com a cor da prancha; não há `hat_color`).
  beard: ['sem barba', 'barba cheia', 'sombra de barba', 'cavanhaque com bigode', 'cavanhaque'],
  hat: [
    'sem chapéu',
    'boné azul',
    'boné vermelho',
    'boné preto',
    'chapéu de palha',
    'boné vermelho de lado',
    'gorro azul com pompom',
    'gorro vermelho canelado',
    'chapéu fedora',
    'chapéu de pescador',
    'boné preto e vermelho',
  ],
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

/** Cores de cabelo, sobrancelha e bigode (input `hair_color`). A barba usa a mesma cor. */
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
