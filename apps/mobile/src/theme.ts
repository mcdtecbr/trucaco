/** Tokens de tema simples do cliente (3E). A migração para `packages/ui` fica para o bloco 3F. */
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
  success: '#9BE3B0',
  focus: '#FFFFFF',
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 12, round: 999 } as const;
export const fontSize = { small: 14, body: 16, title: 24, code: 36 } as const;

/** Alvo de toque mínimo (pt) exigido pela acessibilidade. */
export const MIN_TOUCH = 44;
/** Largura máxima da coluna central (web e tablets). */
export const MAX_COLUMN_WIDTH = 480;

/** Contraste WCAG entre duas cores `#RRGGBB`. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = Number.parseInt(hex.slice(1), 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
