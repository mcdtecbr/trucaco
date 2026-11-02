/**
 * Tokens de tema do Trucaco: única fonte de cor, espaçamento, tipografia, raio e sombra.
 * Nenhum componente usa valor mágico; pares texto/fundo têm contraste AA conferido em `tokens.test.ts`.
 */
export const colors = {
  background: '#0F2A1E',
  surface: '#17402D',
  surfaceAlt: '#1F5139',
  border: '#3C7A59',
  text: '#F5F1E6',
  textMuted: '#BFD0C4',
  primary: '#F2C14E',
  onPrimary: '#14231B',
  danger: '#FFB4A9',
  onDanger: '#3A0D08',
  success: '#9BE3B0',
  focus: '#FFFFFF',
  overlay: 'rgba(0,0,0,0.55)',
} as const;

/** Baralho: face clara, naipes vermelhos e pretos, verso azul-escuro com padrão. */
export const cardColors = {
  face: '#FBF8EF',
  faceBorder: '#B9B29C',
  red: '#B3261E',
  black: '#1B1B1B',
  back: '#1D3A7A',
  backPattern: '#8FA8E6',
  backBorder: '#D9E2FF',
  manilha: '#F2C14E',
  selected: '#5AA9FF',
  /** Face de carta indisponível: cinza-areia (texto continua legível), com borda tracejada. */
  faceDisabled: '#DDD9CA',
} as const;

/**
 * Cores FIXAS por perspectiva, não por número da dupla: azul = minha dupla ("Nós"), laranja =
 * adversários ("Eles"), seja eu dupla 0 ou 1. Cada cor tem a cor de texto sobre ela.
 */
export const teamColors = {
  mine: { main: '#7CC6FE', on: '#08233A' },
  theirs: { main: '#FFB26B', on: '#3A1D00' },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, round: 999 } as const;
export const fontSize = {
  caption: 12,
  small: 14,
  body: 16,
  large: 20,
  title: 24,
  score: 40,
  code: 36,
} as const;
export const fontWeight = { regular: '400', bold: '700', heavy: '800' } as const;

/** Sombras simples (iOS/web via shadow*, Android via elevation). */
export const shadows = {
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 3,
  },
  raised: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
} as const;

/** Alvo de toque mínimo (pt) exigido pela acessibilidade. */
export const MIN_TOUCH = 44;
/** Largura máxima da coluna central (web e tablets). */
export const MAX_COLUMN_WIDTH = 480;
/** Largura (px) a partir da qual o web usa a lateral com placar, histórico e chat. */
export const WIDE_BREAKPOINT = 900;

/** Dimensões das cartas por tamanho (largura x altura, proporção 5:7, e corpos de fonte internos). */
export const cardSizes = {
  sm: { width: 44, height: 62, rank: 14, suit: 12, center: 20, question: 24, mini: 12 },
  md: { width: 64, height: 90, rank: 18, suit: 16, center: 34, question: 30, mini: 15 },
  lg: { width: 84, height: 118, rank: 22, suit: 20, center: 44, question: 38, mini: 18 },
} as const;
export type CardSize = keyof typeof cardSizes;

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}

/** Contraste WCAG entre duas cores `#RRGGBB`. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
