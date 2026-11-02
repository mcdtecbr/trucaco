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
