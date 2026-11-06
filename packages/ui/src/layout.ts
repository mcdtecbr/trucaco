import { useWindowDimensions } from 'react-native';
import { WIDE_BREAKPOINT } from './tokens';

export type LayoutMode = 'phone' | 'wide';

/** Celular em retrato (coluna única) ou web largo (>= 900 px, com lateral). */
export function layoutModeFor(width: number): LayoutMode {
  return width >= WIDE_BREAKPOINT ? 'wide' : 'phone';
}

export function useLayoutMode(): LayoutMode {
  return layoutModeFor(useWindowDimensions().width);
}

/**
 * Disposição da mesa: `phone` (retrato, placar no topo, dock embaixo), `landscape` (celular deitado,
 * mesa horizontal compacta) e `wide` (web largo, mesa horizontal com avatares maiores).
 */
export type TableLayout = 'phone' | 'landscape' | 'wide';

/** Altura (px) abaixo da qual uma tela deitada é tratada como celular (`landscape`). */
export const LANDSCAPE_MAX_HEIGHT = 600;

export function tableLayoutFor(width: number, height: number): TableLayout {
  if (width >= WIDE_BREAKPOINT && height >= LANDSCAPE_MAX_HEIGHT) return 'wide';
  if (width > height && height < LANDSCAPE_MAX_HEIGHT) return 'landscape';
  return 'phone';
}

/** `landscape` e `wide` compartilham a mesa horizontal (parceiro em cima, adversários nos lados). */
export function isHorizontalTable(layout: TableLayout): boolean {
  return layout !== 'phone';
}

export function useTableLayout(): TableLayout {
  const { width, height } = useWindowDimensions();
  return tableLayoutFor(width, height);
}
