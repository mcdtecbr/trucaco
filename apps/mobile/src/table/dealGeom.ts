import type { RefObject } from 'react';
import type { ViewHandle } from '@trucaco/ui';

export interface DealGeom {
  /** Tamanho do pano (raiz do overlay). */
  readonly felt: { readonly w: number; readonly h: number };
  /** Centro da grade da vaza, em coordenadas do overlay. */
  readonly trick: { readonly x: number; readonly y: number };
  /** Centro da mão real, em coordenadas do overlay (`null` = não medida). */
  readonly hand: { readonly x: number; readonly y: number } | null;
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function measure(ref: RefObject<ViewHandle | null>): Promise<Box | null> {
  return new Promise((resolve) => {
    const node = ref.current;
    if (node === null || typeof node.measureInWindow !== 'function') {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      resolve(w > 0 && h > 0 ? { x, y, w, h } : null);
    });
  });
}

/** Converte as caixas medidas na janela em centros relativos ao pano. Só apresentação. */
export function relativeCenters(felt: Box, trick: Box, hand: Box | null): DealGeom {
  const center = (b: Box): { x: number; y: number } => ({
    x: b.x + b.w / 2 - felt.x,
    y: b.y + b.h / 2 - felt.y,
  });
  return { felt: { w: felt.w, h: felt.h }, trick: center(trick), hand: hand ? center(hand) : null };
}

/** Mede pano, vaza e mão na janela e devolve a geometria do overlay (ou `null` sem medida). */
export async function measureDealGeom(
  feltRef: RefObject<ViewHandle | null>,
  trickRef: RefObject<ViewHandle | null>,
  handRef: RefObject<ViewHandle | null>,
): Promise<DealGeom | null> {
  const [felt, trick, hand] = await Promise.all([
    measure(feltRef),
    measure(trickRef),
    measure(handRef),
  ]);
  if (felt === null || trick === null) return null;
  return relativeCenters(felt, trick, hand);
}
