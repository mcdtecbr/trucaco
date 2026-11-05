/**
 * Geometria do pano em celular deitado (`landscape`), em coordenadas da arena (a area util dentro da
 * madeira). So apresentacao: serve para posicionar parceiro, adversarios, vaza, monte (com a vira) e
 * painel de status sem que se sobreponham, e para o teste de nao colisao. Os outros layouts usam flex.
 */
import { PEEK_PX, SEAT_NAME_GAP, SEAT_NAME_H, cardSizes } from '@trucaco/ui';
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
/** Altura do apelido sob o avatar (folga + linha de nome). Soma-se a toda caixa de assento. */
export const NAME_BLOCK = SEAT_NAME_GAP + SEAT_NAME_H;
/**
 * Monte com a vira saindo por baixo (canto esquerdo), igual em todos os layouts: largura da caixa,
 * posicao do monte e da vira dentro dela e a area do texto das manilhas fixas do Mineiro (ate duas linhas) abaixo.
 */
export const DECK_GROUP_W = 76;
export const DECK_IN_X = 8;
/** A vira desce `VIRA_IN_Y` a partir do topo do monte e se desloca para a direita, levemente inclinada. */
export const VIRA_IN_Y = 30;
export const VIRA_IN_X = DECK_IN_X + 14;
export const VIRA_ROTATION = 8;
export const DECK_LABEL_Y = VIRA_IN_Y + DECK_H + 2;
export const DECK_LABEL_H = 28;
export const DECK_GROUP_H = DECK_LABEL_Y + DECK_LABEL_H;
/** Altura reservada ao painel de status no canto (vez + aposta pendente). */
export const STATUS_H = 100;
export const STATUS_MAX_W = 170;
/** Altura do aviso "Vaza de fulano" sob a fileira da vaza. */
export const WINNER_H = 17;
const GAP = 8;
/** Folga minima entre o painel de status e os avatares vizinhos quando falta largura. */
const TIGHT = 4;
/** Retrato: adversarios das bordas descem este tanto do centro para o monte com a vira nao encostar. */
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
  // (o meu avatar, com o apelido, fica no centro da dock em todos os layouts)
  const chrome =
    layout === 'landscape'
      ? 44 + 16 + 28 + 98 + NAME_BLOCK
      : layout === 'phone'
        ? 62 + 16 + 28 + 202
        : 62 + 16 + 28 + 150;
  return { w: Math.max(0, width - 8 - FELT_PAD * 2), h: Math.max(0, height - chrome) };
}

export interface SeatRects {
  /** So o avatar (quadrado com anel). */
  readonly avatar: Rect;
  /** Avatar, apelido embaixo e as costas das cartas que saem por tras dele. */
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
  /** Caixa do monte com a vira e o texto do Mineiro; `deck` e `vira` sao as cartas dentro dela. */
  readonly deckGroup: Rect;
  readonly deck: Rect;
  readonly vira: Rect;
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
  const seatH = box + NAME_BLOCK;
  const partnerAvatar: Rect = { x: (w - box) / 2, y: 0, w: box, h: box };
  const leftAvatar: Rect = { x: 0, y: (h - box) / 2, w: box, h: box };
  const rightAvatar: Rect = { x: w - box, y: (h - box) / 2, w: box, h: box };
  // Costas das cartas: parceiro e esquerda saem para a direita; direita, para a esquerda. O apelido
  // fica sob o avatar, dentro da caixa do assento.
  const partner: SeatRects = {
    avatar: partnerAvatar,
    all: { ...partnerAvatar, w: box + PEEK_PX, h: seatH },
  };
  const left: SeatRects = {
    avatar: leftAvatar,
    all: { ...leftAvatar, w: box + PEEK_PX, h: seatH },
  };
  const right: SeatRects = {
    avatar: rightAvatar,
    all: { ...rightAvatar, x: rightAvatar.x - PEEK_PX, w: box + PEEK_PX, h: seatH },
  };
  const tw = TRICK_W * k;
  const th = TRICK_H * k;
  const trickTop = seatH + 4;
  const trick: Rect = {
    x: (w - tw) / 2,
    y: trickTop + Math.max(0, (h - trickTop - th) / 2),
    w: tw,
    h: th,
  };
  const leftX = left.all.x + left.all.w + GAP;
  const rightX = Math.max(trick.x + trick.w + GAP, partner.all.x + partner.all.w + TIGHT);
  // Monte com a vira embaixo: canto esquerdo, ao lado das costas das cartas do adversario da esquerda.
  const deckGroup: Rect = { x: leftX, y: 0, w: DECK_GROUP_W, h: DECK_GROUP_H };
  const deck: Rect = { x: leftX + DECK_IN_X, y: 0, w: DECK_W, h: DECK_H };
  const vira: Rect = { x: leftX + VIRA_IN_X, y: VIRA_IN_Y, w: DECK_W, h: DECK_H };
  // "De quem e a vez": de preferencia no canto esquerdo, logo ao lado do monte; sem largura para o
  // texto ficar legivel, vai para a direita do parceiro.
  const statusH = Math.max(0, Math.min(STATUS_H, h + FELT_PAD));
  const statusLeftX = deckGroup.x + deckGroup.w + GAP;
  const statusLeftW = Math.min(STATUS_MAX_W, Math.min(trick.x, partner.all.x) - GAP - statusLeftX);
  const status: Rect =
    statusLeftW >= STATUS_MIN_W
      ? { x: statusLeftX, y: 0, w: statusLeftW, h: statusH }
      : {
          x: rightX,
          y: 0,
          w: Math.min(STATUS_MAX_W, right.all.x - TIGHT - rightX),
          h: statusH,
        };
  return {
    partner,
    left,
    right,
    trick,
    trickBox: boxOf(trick, TRICK_W, TRICK_H),
    trickScale: k,
    deckGroup,
    deck,
    vira,
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
    ['monte', g.deckGroup],
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
  return (
    g.status.w >= STATUS_MIN_W &&
    g.trick.y + g.trick.h <= limit &&
    g.deckGroup.y + g.deckGroup.h <= limit
  );
}

/**
 * Posicoes do pano deitado. Tenta a escala cheia e vai reduzindo a vaza (ate metade) ate nada
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

/** Retangulos do retrato (flex): so para conferir que o monte com a vira nao encosta nos avatares. */
export function phoneRects(
  w: number,
  h: number,
  avatar: number,
): { partner: Rect; left: Rect; right: Rect; deckGroup: Rect } {
  const box = avatar + RING_PX * 2;
  // Costas das cartas saem para baixo (PEEK_PX) e o apelido fica abaixo delas.
  const tall = box + PEEK_PX + NAME_BLOCK + SEAT_NAME_GAP;
  return {
    partner: { x: (w - box) / 2, y: 0, w: box, h: tall },
    left: { x: 0, y: (h - box) / 2 + PHONE_SIDE_SHIFT, w: box, h: tall },
    right: { x: w - box, y: (h - box) / 2 + PHONE_SIDE_SHIFT, w: box, h: tall },
    deckGroup: { x: 0, y: 0, w: DECK_GROUP_W, h: DECK_GROUP_H },
  };
}

/* ---------- Dock: planos de largura (so apresentacao) ---------- */

const FAN_MARGIN = 4;
/** Largura da mao de 3 cartas (leque com margem negativa) por tamanho de carta. */
export function handWidth(size: 'sm' | 'md' | 'lg'): number {
  return 3 * (cardSizes[size].width - 2 * FAN_MARGIN);
}
const DOCK_GAP = 8;
/** Padding horizontal da dock (dos dois lados). */
export const DOCK_PAD_X = 16;
const SIGNAL_W = 72;
/** Largura minima util do chat compacto (campo + Enviar + expandir). */
export const CHAT_COMPACT_MIN_W = 150;
/** Abaixo disto (largura da janela) o chat de canto no web largo cobriria o botao de aposta. */
export const CHAT_CORNER_MIN_WIDTH = 1260;

/** Retrato: botao(oes) de aposta ao lado da mao (`inline`) ou na linha dos sinais (`below`), sem quebra. */
export function phoneDockPlan(
  availW: number,
  handSize: 'sm' | 'md' | 'lg',
  betNeed: number,
): 'inline' | 'below' {
  return betNeed === 0 || handWidth(handSize) + DOCK_GAP + betNeed <= availW ? 'inline' : 'below';
}

export interface LandscapeDockPlan {
  readonly hand: 'sm' | 'md';
  /** Largura minima do grupo mao + aposta (a metade direita nunca quebra). */
  readonly rightMin: number;
  /** Largura que sobra a esquerda do avatar (sinais e chat). */
  readonly leftRoom: number;
  readonly showChat: boolean;
}

/** Paisagem: avatar no centro; mao + aposta a direita dele numa linha so (mao `sm` quando falta largura). */
export function landscapeDockPlan(
  width: number,
  avatarBox: number,
  betNeed: number,
): LandscapeDockPlan {
  const room = width - 2 * DOCK_PAD_X - avatarBox - 2 * DOCK_GAP;
  const half = room / 2;
  const need = (size: 'sm' | 'md'): number =>
    handWidth(size) + (betNeed > 0 ? DOCK_GAP + betNeed : 0);
  const hand: 'sm' | 'md' = need('md') <= half ? 'md' : 'sm';
  const rightMin = need(hand);
  const leftRoom = rightMin <= half ? half : room - rightMin;
  return {
    hand,
    rightMin,
    leftRoom,
    showChat: leftRoom >= SIGNAL_W + DOCK_GAP + CHAT_COMPACT_MIN_W,
  };
}

/** Retrato/web: faixas do pano ocupadas pelo parceiro (em cima) e por mim (embaixo) e escala da vaza. */
export function flexZones(
  avatar: number,
  partnerPeeksDown: boolean,
): {
  partnerZone: number;
  mineZone: number;
} {
  const box = avatar + 2 * RING_PX;
  return {
    partnerZone: box + (partnerPeeksDown ? PEEK_PX : 0) + NAME_BLOCK + 4,
    mineZone: box + NAME_BLOCK + 4,
  };
}

export function crossHeight(playedH: number): number {
  return 3 * (playedH + 8) - 2 * Math.round(playedH * 0.3) + WINNER_H;
}

export function trickFitScale(
  arenaH: number,
  zones: { partnerZone: number; mineZone: number },
  playedH: number,
  base = 1,
): number {
  return Math.min(
    base,
    Math.max(0.6, (arenaH - zones.partnerZone - zones.mineZone) / crossHeight(playedH)),
  );
}
