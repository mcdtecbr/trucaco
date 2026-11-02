import { AVATAR_PART_COUNTS, type AvatarPartKey } from '@trucaco/protocol';

/**
 * Descrição em palavras de cada variante, na ORDEM DOS ÍNDICES (índice 0 = primeiro item).
 * É o que o ilustrador do `.riv` segue (docs/avatar-rig.md) e o que o editor de avatar pode exibir
 * como rótulo. Só se acrescenta ao fim; nunca reordenar (índices já estão gravados nos perfis).
 */
export const PART_VARIANT_NAMES: Readonly<Record<AvatarPartKey, readonly string[]>> = {
  face_shape: ['redondo', 'oval comprido', 'quadrado de cantos suaves', 'largo e achatado'],
  skin: ['bege claro', 'bege rosado', 'dourado', 'moreno', 'marrom', 'marrom escuro'],
  hair: [
    'careca',
    'curto rente',
    'repartido de lado',
    'topete reto',
    'longo solto',
    'coque no alto',
    'black power',
    'moicano',
  ],
  eyes: ['redondos pequenos', 'grandes com brilho', 'estreitos', 'felizes em arco'],
  mouth: ['sorriso aberto suave', 'reta', 'aberta (oval)', 'sorriso de canto'],
  outfit: [
    'camiseta lisa vermelha',
    'gola em V azul',
    'listras verdes',
    'moletom amarelo',
    'terno escuro com gravata',
    'camisa de time roxa com distintivo',
  ],
  accessory: ['nenhum', 'óculos redondos', 'óculos escuros', 'boné', 'bigode'],
  bg_color: [
    'verde-mesa',
    'azul',
    'vermelho-tijolo',
    'amarelo',
    'roxo',
    'laranja',
    'turquesa',
    'cinza-azulado',
  ],
};

/** Cores (hex) usadas pelo avatar vetorial. Mesmas cores servem de referência para o `.riv`. */
export const SKIN_COLORS: readonly string[] = [
  '#F6D5B8',
  '#EDB79A',
  '#D9A066',
  '#B97A4B',
  '#8A5533',
  '#5A3724',
];

export const HAIR_COLORS: readonly string[] = [
  '#2B1B12', // careca: só usada nas sobrancelhas
  '#3A2A1E',
  '#8A5A2B',
  '#1C1C1C',
  '#C9A24B',
  '#6B2E1F',
  '#141414',
  '#3E7C5A',
];

export const OUTFIT_COLORS: readonly string[] = [
  '#C0392B',
  '#2E6FBF',
  '#2F8F57',
  '#E2A82C',
  '#24262E',
  '#7A47B0',
];

export const BG_COLORS: readonly string[] = [
  '#1F6B4A',
  '#2C5C9E',
  '#A8472F',
  '#D4A72C',
  '#6A4A9C',
  '#D9772B',
  '#2A9AA0',
  '#62717F',
];

/** Índice seguro: inteiro dentro de `0..count-1`, senão 0. Nunca lança. */
export function safeIndex(key: AvatarPartKey, value: unknown): number {
  const max = AVATAR_PART_COUNTS[key];
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max
    ? value
    : 0;
}
