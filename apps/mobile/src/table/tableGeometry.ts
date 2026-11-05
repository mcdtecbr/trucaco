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
  readonly trick: Rect;
  readonly deck: Rect;
  readonly vira: Rect;
  readonly status: Rect;
}

/** Fileira da vaza: quatro cartas `sm` com margem lateral de 4 px. */
const TRICK_W = 4 * (cardSizes.sm.width + 8);
const TRICK_H = cardSizes.sm.height + WINNER_H;

export function landscapeGeometry(w: number, h: number, avatar: number): LandscapeGeometry {
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
  const trickTop = box + 4;
  const trick: Rect = {
    x: (w - TRICK_W) / 2,
    y: trickTop + Math.max(0, (h - trickTop - TRICK_H) / 2),
    w: TRICK_W,
    h: TRICK_H,
  };
  const leftX = left.all.x + left.all.w + GAP;
  const leftRoom = trick.x - GAP - leftX;
  const rightX = trick.x + trick.w + GAP;
  const together = leftRoom >= DECK_W + 6 + VIRA_LAND_W;
  // Monte e vira no centro-esquerdo, longe dos avatares; sem largura para os dois, o monte vai a direita.
  const deck: Rect = together
    ? { x: leftX, y: 0, w: DECK_W, h: DECK_H }
    : { x: rightX, y: 0, w: DECK_W, h: DECK_H };
  const vira: Rect = {
    x: together ? leftX + DECK_W + 6 : leftX,
    y: 0,
    w: VIRA_LAND_W,
    h: VIRA_LAND_H,
  };
  const statusY = together ? 0 : DECK_H + 4;
  const status: Rect = {
    x: rightX,
    y: statusY,
    w: Math.min(STATUS_MAX_W, right.all.x - GAP - rightX),
    h: STATUS_H,
  };
  return { partner, left, right, trick, deck, vira, status };
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
