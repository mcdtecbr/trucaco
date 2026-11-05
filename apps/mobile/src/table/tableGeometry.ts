/**
 * Geometria do pano em celular deitado (`landscape`), em coordenadas da arena (a area util dentro da
 * madeira). So apresentacao: serve para posicionar parceiro, adversarios, vaza, vira, monte e painel de
 * status sem que se sobreponham, e para o teste de nao colisao. Os outros layouts usam flex.
 */
import { PEEK_PX, cardSizes } from '@trucaco/ui';
import type { TableLayout } from '@trucaco/ui';

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Margem do pano (madeira + folga) ate a arena. */
export const FELT_PAD = 10;
/** Borda de 3 px do anel de time ao redor do avatar. */
export const RING_PX = 3;
export const DECK_W = cardSizes.sm.width;
export const DECK_H = cardSizes.sm.height;
/** Caixa da vira no deitado (carta, legenda e "Manilha: X" em ate duas linhas). */
export const VIRA_LAND_W = 76;
export const VIRA_LAND_H = 117;
/** Caixa da vira no retrato e no web largo (`maxWidth` do `viraBox`), uma linha de manilha. */
export const VIRA_W = 120;
export const VIRA_H = 100;
/** Altura reservada ao painel de status no canto (vez + aposta pendente). */
export const STATUS_H = 100;
export const STATUS_MAX_W = 170;
/** Altura do aviso "Vaza de fulano" sob a fileira da vaza. */
export const WINNER_H = 17;
const GAP = 8;
/** Folga minima entre o painel de status e os avatares vizinhos quando falta largura. */
const TIGHT = 4;
/** Retrato: adversarios das bordas descem este tanto do centro para a vira (com manilha em 2 linhas) nao encostar. */
export const PHONE_SIDE_SHIFT = 8;

export function overlaps(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
  );
}

/** Estimativa da arena antes da medicao (`onLayout`), a partir do tamanho da janela. */
export function estimateArena(
  layout: TableLayout,
  width: number,
  height: number,
): { w: number; h: number } {
  // barra (44; no deitado a faixa do anuncio vai dentro dela) + timer + bordas do pano + dock
  const chrome =
    layout === 'landscape'
      ? 44 + 16 + 28 + 98
      : layout === 'phone'
        ? 62 + 16 + 28 + 202
        : 62 + 16 + 28 + 150;
  return { w: Math.max(0, width - 8 - FELT_PAD * 2), h: Math.max(0, height - chrome) };
}

export interface SeatRects {
  /** So o avatar (quadrado com anel). */
  readonly avatar: Rect;
  /** Avatar mais as costas das cartas que saem por tras dele. */
  readonly all: Rect;
}

export interface LandscapeGeometry {
  readonly partner: SeatRects;
  readonly left: SeatRects;
  readonly right: SeatRects;
  /** Retangulo VISUAL da vaza (ja reduzido por `trickScale`). */
  readonly trick: Rect;
  /** Caixa de layout da vaza (tamanho cheio); desenhar com `scale: trickScale` (centro igual ao visual). */
  readonly trickBox: Rect;
  readonly trickScale: number;
  readonly deck: Rect;
  /** Retangulo visual da vira e a caixa/escala para desenha-la. */
  readonly vira: Rect;
  readonly viraBox: Rect;
  readonly viraScale: number;
  readonly status: Rect;
}

/** Fileira da vaza: quatro cartas `sm` com margem lateral de 4 px. */
const TRICK_W = 4 * (cardSizes.sm.width + 8);
const TRICK_H = cardSizes.sm.height + WINNER_H;
/** Largura minima do painel de status (abaixo disso o texto fica ilegivel). */
export const STATUS_MIN_W = 90;
const SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5] as const;

/** Retangulo de caixa (tamanho cheio) cujo centro coincide com o do retangulo visual reduzido. */
function boxOf(visual: Rect, fullW: number, fullH: number): Rect {
  return {
    x: visual.x + (visual.w - fullW) / 2,
    y: visual.y + (visual.h - fullH) / 2,
    w: fullW,
    h: fullH,
  };
}

function build(w: number, h: number, avatar: number, k: number): LandscapeGeometry {
  const box = avatar + RING_PX * 2;
  const partnerAvatar: Rect = { x: (w - box) / 2, y: 0, w: box, h: box };
  const leftAvatar: Rect = { x: 0, y: (h - box) / 2, w: box, h: box };
  const rightAvatar: Rect = { x: w - box, y: (h - box) / 2, w: box, h: box };
  // Costas das cartas: parceiro e esquerda saem para a direita; direita, para a esquerda.
  const partner: SeatRects = {
    avatar: partnerAvatar,
    all: { ...partnerAvatar, w: box + PEEK_PX },
  };
  const left: SeatRects = { avatar: leftAvatar, all: { ...leftAvatar, w: box + PEEK_PX } };
  const right: SeatRects = {
    avatar: rightAvatar,
    all: { ...rightAvatar, x: rightAvatar.x - PEEK_PX, w: box + PEEK_PX },
  };
  const tw = TRICK_W * k;
  const th = TRICK_H * k;
  const trickTop = box + 4;
  const trick: Rect = {
    x: (w - tw) / 2,
    y: trickTop + Math.max(0, (h - trickTop - th) / 2),
    w: tw,
    h: th,
  };
  const leftX = left.all.x + left.all.w + GAP;
  // Monte, vira e status ficam fora da faixa do parceiro (que vai ate o fim das costas das cartas).
  const leftRoom = Math.min(trick.x, partner.all.x) - GAP - leftX;
  const rightX = Math.max(trick.x + trick.w + GAP, partner.all.x + partner.all.w + TIGHT);
  const vw = VIRA_LAND_W * k;
  const together = leftRoom >= DECK_W + 6 + vw;
  // Monte e vira no centro-esquerdo, longe dos avatares; sem largura para os dois, o monte vai a direita.
  const deck: Rect = { x: together ? leftX : rightX, y: 0, w: DECK_W, h: DECK_H };
  const vira: Rect = {
    x: together ? leftX + DECK_W + 6 : leftX,
    y: 0,
    w: vw,
    h: VIRA_LAND_H * k,
  };
  const statusY = together ? 0 : DECK_H + 4;
  const status: Rect = {
    x: rightX,
    y: statusY,
    w: Math.min(STATUS_MAX_W, right.all.x - TIGHT - rightX),
    h: Math.max(0, Math.min(STATUS_H, h + FELT_PAD - statusY)),
  };
  return {
    partner,
    left,
    right,
    trick,
    trickBox: boxOf(trick, TRICK_W, TRICK_H),
    trickScale: k,
    deck,
    vira,
    viraBox: boxOf(vira, VIRA_LAND_W, VIRA_LAND_H),
    viraScale: k,
    status,
  };
}

/** Retangulos que nao podem se sobrepor entre si. */
export function landscapeParts(g: LandscapeGeometry): [string, Rect][] {
  return [
    ['parceiro', g.partner.all],
    ['esquerda', g.left.all],
    ['direita', g.right.all],
    ['vaza', g.trick],
    ['monte', g.deck],
    ['vira', g.vira],
    ['status', g.status],
  ];
}

export function landscapeFits(g: LandscapeGeometry, h: number): boolean {
  const parts = landscapeParts(g);
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      if (overlaps((parts[i] as [string, Rect])[1], (parts[j] as [string, Rect])[1], 2)) {
        return false;
      }
    }
  }
  const limit = h + FELT_PAD;
  return g.status.w >= STATUS_MIN_W && g.trick.y + g.trick.h <= limit && g.vira.h <= limit;
}

/**
 * Posicoes do pano deitado. Tenta a escala cheia e vai reduzindo vaza e vira (ate metade) ate nada
 * colidir, o painel de status ter ao menos `STATUS_MIN_W` e a vaza caber sem descer sobre a madeira.
 */
export function landscapeGeometry(w: number, h: number, avatar: number): LandscapeGeometry {
  let last = build(w, h, avatar, 1);
  for (const k of SCALES) {
    last = build(w, h, avatar, k);
    if (landscapeFits(last, h)) return last;
  }
  return last;
}

/** Retangulos do retrato (flex): so para conferir que a vira nao encosta nos avatares das bordas. */
export function phoneRects(
  w: number,
  h: number,
  avatar: number,
  viraH = VIRA_H,
): { partner: Rect; left: Rect; right: Rect; vira: Rect } {
  const box = avatar + RING_PX * 2;
  const tall = box + PEEK_PX;
  return {
    partner: { x: (w - box) / 2, y: 0, w: box, h: tall },
    left: { x: 0, y: (h - box) / 2 + PHONE_SIDE_SHIFT, w: box, h: tall },
    right: { x: w - box, y: (h - box) / 2 + PHONE_SIDE_SHIFT, w: box, h: tall },
    vira: { x: w - VIRA_W, y: 0, w: VIRA_W, h: viraH },
  };
}
