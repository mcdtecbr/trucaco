import { useEffect, useRef } from 'react';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
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

export interface PlayedCardsProps {
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
  /** Recebe a vista raiz da vaza (para medir a posição na tela e partir dela no recolher). */
  readonly containerRef?: Ref<ViewHandle>;
}

const GRID: readonly (readonly (ScreenPosition | null)[])[] = [
  [null, 'partner', null],
  ['left', null, 'right'],
  [null, 'self', null],
];

/** Fileira: eu, o da direita, o parceiro e o da esquerda (a ordem em que se joga). */
const ROW: readonly (readonly (ScreenPosition | null)[])[] = [['self', 'right', 'partner', 'left']];

const TILT: Readonly<Record<ScreenPosition, number>> = { self: 0, partner: 0, left: -8, right: 8 };

/** Cartas jogadas na vaza em curso, em cruz: eu embaixo, parceiro em cima, adversários nos lados. */
export function PlayedCards(p: PlayedCardsProps) {
  const size = p.size ?? 'md';
  const { byPosition, order } = placePlays(p.plays, p.mySeat);
  const flat = p.arrangement === 'row';
  return (
    <View
      ref={p.containerRef}
      collapsable={false}
      accessibilityRole="summary"
      accessibilityLabel={order.length === 0 ? 'Nenhuma carta na mesa' : 'Cartas na mesa'}
      style={styles.grid}
      pointerEvents="box-none"
    >
      {(flat ? ROW : GRID).map((row, r) => (
        <View
          key={r}
          pointerEvents="box-none"
          style={[styles.row, r > 0 && { marginTop: -Math.round(cardSizes[size].height * 0.3) }]}
        >
          {row.map((pos, c) => {
            const play = pos === null ? undefined : byPosition[pos];
            if (pos === null || play === undefined) {
              return <View key={c} style={slotSize(size, flat)} pointerEvents="none" />;
            }
            const own = play.seat === p.mySeat && play.covered ? p.ownCovered : null;
            const face = parseFace(own ?? play);
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
            return (
              <View
                key={c}
                style={[
                  slotSize(size, flat),
                  { zIndex: order.indexOf(pos) + 1, transform: [{ rotate: `${TILT[pos]}deg` }] },
                ]}
              >
                {p.slideMs !== undefined ? (
                  <SlideIn
                    key={`${play.seat}:${play.rank}${play.suit}:${String(play.covered)}`}
                    pos={pos}
                    size={size}
                    ms={p.slideMs}
                  >
                    {cardNode}
                  </SlideIn>
                ) : (
                  cardNode
                )}
              </View>
            );
          })}
        </View>
      ))}
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
  readonly children: ReactNode;
}) {
  const from = slideFrom(p.pos, cardSizes[p.size].width, cardSizes[p.size].height);
  // Decide só na montagem: cartas já presentes quando o deslize é armado (reconexão) ficam paradas.
  const ms = useRef(p.ms).current;
  const t = useRef(new Animated.Value(ms > 0 ? 0 : 1)).current;
  useEffect(() => {
    if (ms <= 0) return undefined;
    const anim = Animated.timing(t, {
      toValue: 1,
      duration: ms,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    });
    anim.start();
    return () => anim.stop();
  }, [t, ms]);
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
 * Centro de cada carta da vaza em relação ao centro da grade de `PlayedCards` (mesma geometria dos
 * slots: margem `spacing.xs`, linhas da cruz sobrepostas em 30% da altura). Serve para o recolher
 * partir exatamente da carta real.
 */
export function trickSlotOffsets(
  size: CardSize,
  arrangement: 'cross' | 'row' = 'cross',
): Record<ScreenPosition, { x: number; y: number }> {
  const { width: w, height: h } = cardSizes[size];
  if (arrangement === 'row') {
    const step = w + 2 * spacing.xs;
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

/** Inclinação (graus) da carta de cada posição na vaza. */
export const TRICK_TILT = TILT;

function slotSize(size: CardSize, flat = false) {
  const d = cardSizes[size];
  return flat
    ? { width: d.width, height: d.height, marginHorizontal: spacing.xs }
    : { width: d.width, height: d.height, margin: spacing.xs };
}

const styles = StyleSheet.create({
  grid: { alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center' },
});
