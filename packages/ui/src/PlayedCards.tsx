import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Animated, Easing, Platform, View } from 'react-native';
import type { Rank, Suit } from '@trucaco/protocol';
import { Card, cardLabel } from './Card';
import { parseFace } from './cardInfo';
import { screenPosition } from './position';
import type { ScreenPosition } from './position';
import { cardSizes, spacing } from './tokens';
import type { CardSize } from './tokens';

export type ViewHandle = ComponentRef<typeof View>;

export interface PlayedCardView {
  readonly seat: number;
  readonly rank: string;
  readonly suit: string;
  readonly covered: boolean;
}

/**
 * Distribui as cartas da vaza pelas posições relativas ao jogador local. Assento repetido: vale a
 * última jogada. A ordem de chegada é preservada em `order` (para a sobreposição).
 */
export function placePlays(
  plays: readonly PlayedCardView[],
  mySeat: number,
): {
  byPosition: Partial<Record<ScreenPosition, PlayedCardView>>;
  order: readonly ScreenPosition[];
} {
  const byPosition: Partial<Record<ScreenPosition, PlayedCardView>> = {};
  const order: ScreenPosition[] = [];
  for (const play of plays) {
    const pos = screenPosition(mySeat, play.seat);
    if (byPosition[pos] === undefined) order.push(pos);
    byPosition[pos] = play;
  }
  return { byPosition, order };
}

/** Uma vaza da mão (cartas e, se for minha, a identidade da minha carta coberta). */
export interface PlayedTrickView {
  readonly plays: readonly PlayedCardView[];
  readonly ownCovered?: { readonly rank: string; readonly suit: string } | null;
}

export interface PlayedCardsProps {
  /** Vaza mais recente (a em curso, ou a última fechada). */
  readonly plays: readonly PlayedCardView[];
  readonly mySeat: number;
  /** Identidade da PRÓPRIA carta coberta nesta vaza (de `privates[mySeat].ownCovered`). */
  readonly ownCovered?: { readonly rank: string; readonly suit: string } | null;
  readonly manilhas?: readonly { readonly rank: Rank; readonly suit: Suit }[];
  readonly nicknameOf?: (seat: number) => string;
  readonly size?: CardSize;
  /** `cross` (padrão): em cruz. `row`: uma fileira na ordem de jogo a partir de mim (celular deitado, sem altura). */
  readonly arrangement?: 'cross' | 'row';
  /** Duração (ms) do deslize da carta jogada, do assento até a vaza. Ausente ou 0 = sem animação. */
  readonly slideMs?: number;
  /**
   * Cartas que entram juntas na mesa (ex.: bots que jogaram durante a distribuição) deslizam uma depois da
   * outra, com este intervalo entre elas (ms). Padrão: 70% do deslize. Carta que chega sozinha não espera.
   */
  readonly staggerMs?: number;
  /** Recebe a vista raiz da vaza (para medir a posição na tela e partir dela no recolher). */
  readonly containerRef?: Ref<ViewHandle>;
}

/** Cartas por jogador na mesa: uma só (a vaza fechada volta ao monte antes da seguinte). */
export const MAX_FAN = 1;
/**
 * Quanto cada carta mais nova avança sobre a anterior, em fração da largura. Na cruz sobra espaço e o
 * índice da carta velha segue legível; na fileira (celular deitado) a mesa é apertada: só o suficiente
 * para ver quantas cartas cada jogador já pôs.
 */
const FAN_RATIO = { cross: 0.3, row: 0.12 } as const;
/** Espaço entre os slots da fileira (já com o leque dentro de cada slot). */
const ROW_GAP = spacing.xs;

/** Avanço horizontal entre as cartas jogadas de um mesmo jogador (a mais nova fica por cima, à direita). */
export function trickFanStep(size: CardSize, arrangement: 'cross' | 'row' = 'cross'): number {
  return Math.round(cardSizes[size].width * FAN_RATIO[arrangement]);
}

const TILT: Readonly<Record<ScreenPosition, number>> = { self: 0, partner: 0, left: -8, right: 8 };

/**
 * Cartas da vaza em curso (ou da fechada, retida na pausa antes de voltar ao monte). Em cruz: eu embaixo,
 * parceiro em cima, adversários nos lados; em fileira, na ordem de jogo. A caixa tem tamanho fixo.
 */
export function PlayedCards(p: PlayedCardsProps) {
  const size = p.size ?? 'md';
  const arrangement = p.arrangement === 'row' ? 'row' : 'cross';
  const layers: readonly PlayedTrickView[] = [{ plays: p.plays, ownCovered: p.ownCovered ?? null }];
  const foot = trickFootprint(size, arrangement);
  const { width: cw, height: ch } = cardSizes[size];
  const total = layers.reduce((n, l) => n + l.plays.length, 0);
  // Cartas ainda não vistas neste componente (o conjunto só é gravado depois do commit): as que entram no
  // mesmo render deslizam em fila, na ordem em que foram jogadas.
  const seen = useRef<ReadonlySet<string>>(new Set());
  // Na primeira renderização (ex.: giro de tela com a mesa cheia) não há fila: tudo entra junto.
  const mounted = useRef(false);
  const entering = new Map<string, number>();
  const slideKey = (k: number, play: PlayedCardView): string =>
    `${k}:${play.seat}:${play.rank}${play.suit}:${String(play.covered)}`;
  layers.forEach((layer, k) => {
    const { byPosition, order } = placePlays(layer.plays, p.mySeat);
    for (const pos of order) {
      const play = byPosition[pos];
      if (play === undefined) continue;
      const key = slideKey(k, play);
      if (!seen.current.has(key) && !entering.has(key))
        entering.set(key, mounted.current ? entering.size : 0);
    }
  });
  useEffect(() => {
    mounted.current = true;
    const next = new Set<string>();
    layers.forEach((layer, k) => layer.plays.forEach((play) => next.add(slideKey(k, play))));
    seen.current = next;
  });
  const stagger = p.staggerMs ?? Math.round((p.slideMs ?? 0) * 0.7);
  return (
    <View
      ref={p.containerRef}
      collapsable={false}
      accessibilityRole="summary"
      accessibilityLabel={total === 0 ? 'Nenhuma carta na mesa' : 'Cartas na mesa'}
      style={{ width: foot.width, height: foot.height }}
      pointerEvents="box-none"
    >
      {layers.map((layer, k) => {
        const { byPosition, order } = placePlays(layer.plays, p.mySeat);
        return order.map((pos) => {
          const play = byPosition[pos];
          if (play === undefined) return null;
          const own = play.seat === p.mySeat && play.covered ? (layer.ownCovered ?? null) : null;
          // Coberta de outro jogador: nunca se lê identidade, mesmo que ela viesse no dado.
          const face = play.covered ? (own !== null ? parseFace(own) : null) : parseFace(play);
          const who = p.nicknameOf?.(play.seat);
          const manilha =
            face !== null &&
            !play.covered &&
            (p.manilhas ?? []).some((m) => m.rank === face.rank && m.suit === face.suit);
          const base = {
            ...(face !== null ? { rank: face.rank, suit: face.suit } : {}),
            covered: play.covered,
            manilha,
          };
          const label = cardLabel(base);
          const cardNode = (
            <Card
              size={size}
              {...base}
              accessibilityLabel={who !== undefined ? `${who}: ${label}` : label}
            />
          );
          const off = trickCardOffset(size, arrangement, pos, k);
          return (
            <View
              key={`${k}:${pos}`}
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                left: foot.width / 2 + off.x - cw / 2,
                top: foot.height / 2 + off.y - ch / 2,
                width: cw,
                height: ch,
                zIndex: k * 8 + order.indexOf(pos) + 1,
                transform: [{ rotate: `${TILT[pos]}deg` }],
              }}
            >
              {p.slideMs !== undefined ? (
                <SlideIn
                  key={`${play.seat}:${play.rank}${play.suit}:${String(play.covered)}`}
                  pos={pos}
                  size={size}
                  ms={p.slideMs}
                  delay={(entering.get(slideKey(k, play)) ?? 0) * stagger}
                >
                  {cardNode}
                </SlideIn>
              ) : (
                cardNode
              )}
            </View>
          );
        });
      })}
    </View>
  );
}

/** Distância, em múltiplos do tamanho da carta, de onde a carta jogada começa a deslizar. */
export function slideFrom(
  pos: ScreenPosition,
  w: number,
  h: number,
): { readonly x: number; readonly y: number } {
  switch (pos) {
    case 'self':
      return { x: 0, y: h * 2.4 };
    case 'partner':
      return { x: 0, y: -h * 2.4 };
    case 'left':
      return { x: -w * 3.2, y: 0 };
    case 'right':
      return { x: w * 3.2, y: 0 };
  }
}

/** Desliza o filho do assento do jogador até o lugar na vaza, desacelerando (ease-out). */
function SlideIn(p: {
  readonly pos: ScreenPosition;
  readonly size: CardSize;
  readonly ms: number;
  /** Espera antes de começar (a carta fica invisível): fila de cartas que entram juntas. */
  readonly delay?: number;
  readonly children: ReactNode;
}) {
  const from = slideFrom(p.pos, cardSizes[p.size].width, cardSizes[p.size].height);
  // Decide só na montagem: cartas já presentes quando o deslize é armado (reconexão) ficam paradas.
  const ms = useRef(p.ms).current;
  const delay = useRef(p.delay ?? 0).current;
  const t = useRef(new Animated.Value(ms > 0 ? 0 : 1)).current;
  useEffect(() => {
    if (ms <= 0) return undefined;
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: ms,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [t, ms, delay]);
  const dx = t.interpolate({ inputRange: [0, 1], outputRange: [from.x, 0] });
  const dy = t.interpolate({ inputRange: [0, 1], outputRange: [from.y, 0] });
  const opacity = t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1] });
  return (
    <Animated.View style={{ opacity, transform: [{ translateX: dx }, { translateY: dy }] }}>
      {p.children}
    </Animated.View>
  );
}

/**
 * Centro do slot (primeira carta, sem leque) de cada posição, em relação ao centro da caixa de
 * `PlayedCards`. Na cruz as linhas se sobrepõem em 30% da altura; na fileira cada slot reserva o leque.
 */
export function trickSlotOffsets(
  size: CardSize,
  arrangement: 'cross' | 'row' = 'cross',
): Record<ScreenPosition, { x: number; y: number }> {
  const { width: w, height: h } = cardSizes[size];
  if (arrangement === 'row') {
    const step = w + ROW_GAP + (MAX_FAN - 1) * trickFanStep(size, 'row');
    return {
      self: { x: -1.5 * step, y: 0 },
      right: { x: -0.5 * step, y: 0 },
      partner: { x: 0.5 * step, y: 0 },
      left: { x: 1.5 * step, y: 0 },
    };
  }
  const sw = w + 2 * spacing.xs;
  const sh = h + 2 * spacing.xs;
  const rowStep = sh - Math.round(h * 0.3);
  const total = 2 * rowStep + sh;
  const cy = (r: number): number => r * rowStep + sh / 2 - total / 2;
  return {
    partner: { x: 0, y: cy(0) },
    left: { x: -sw, y: cy(1) },
    right: { x: sw, y: cy(1) },
    self: { x: 0, y: cy(2) },
  };
}

/** Largura e altura da caixa de `PlayedCards` (reserva o leque cheio de `MAX_FAN` cartas por jogador). */
export function trickFootprint(
  size: CardSize,
  arrangement: 'cross' | 'row' = 'cross',
): { width: number; height: number } {
  const { width: w, height: h } = cardSizes[size];
  const fan = (MAX_FAN - 1) * trickFanStep(size, arrangement);
  if (arrangement === 'row') return { width: 4 * (w + ROW_GAP + fan), height: h };
  const sh = h + 2 * spacing.xs;
  return {
    width: 3 * (w + 2 * spacing.xs) + fan,
    height: 3 * sh - 2 * Math.round(h * 0.3),
  };
}

/**
 * Centro da carta da vaza de índice `k` (0 = a primeira da mão) na posição `pos`, em relação ao centro da
 * caixa. O leque cresce para a direita e fica centrado: a primeira carta fica um passo à esquerda do
 * slot e a terceira, um passo à direita.
 */
export function trickCardOffset(
  size: CardSize,
  arrangement: 'cross' | 'row',
  pos: ScreenPosition,
  k: number,
): { x: number; y: number } {
  const slot = trickSlotOffsets(size, arrangement)[pos];
  const step = trickFanStep(size, arrangement);
  const idx = Math.min(Math.max(k, 0), MAX_FAN - 1);
  return { x: slot.x + (idx - (MAX_FAN - 1) / 2) * step, y: slot.y };
}

/** Inclinação (graus) da carta de cada posição na vaza. */
export const TRICK_TILT = TILT;
