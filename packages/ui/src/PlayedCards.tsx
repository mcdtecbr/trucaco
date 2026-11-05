import { StyleSheet, View } from 'react-native';
import type { Rank, Suit } from '@trucaco/protocol';
import { Card, cardLabel } from './Card';
import { parseFace } from './cardInfo';
import { screenPosition } from './position';
import type { ScreenPosition } from './position';
import { cardSizes, spacing } from './tokens';
import type { CardSize } from './tokens';

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
}

const GRID: readonly (readonly (ScreenPosition | null)[])[] = [
  [null, 'partner', null],
  ['left', null, 'right'],
  [null, 'self', null],
];

const TILT: Readonly<Record<ScreenPosition, number>> = { self: 0, partner: 0, left: -8, right: 8 };

/** Cartas jogadas na vaza em curso, em cruz: eu embaixo, parceiro em cima, adversários nos lados. */
export function PlayedCards(p: PlayedCardsProps) {
  const size = p.size ?? 'md';
  const { byPosition, order } = placePlays(p.plays, p.mySeat);
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={order.length === 0 ? 'Nenhuma carta na mesa' : 'Cartas na mesa'}
      style={styles.grid}
      pointerEvents="box-none"
    >
      {GRID.map((row, r) => (
        <View
          key={r}
          pointerEvents="box-none"
          style={[styles.row, r > 0 && { marginTop: -Math.round(cardSizes[size].height * 0.3) }]}
        >
          {row.map((pos, c) => {
            const play = pos === null ? undefined : byPosition[pos];
            if (pos === null || play === undefined) {
              return <View key={c} style={slotSize(size)} pointerEvents="none" />;
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
            return (
              <View
                key={c}
                style={[
                  slotSize(size),
                  { zIndex: order.indexOf(pos) + 1, transform: [{ rotate: `${TILT[pos]}deg` }] },
                ]}
              >
                <Card
                  size={size}
                  {...base}
                  accessibilityLabel={who !== undefined ? `${who}: ${label}` : label}
                />
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function slotSize(size: CardSize) {
  const d = cardSizes[size];
  return { width: d.width, height: d.height, margin: spacing.xs };
}

const styles = StyleSheet.create({
  grid: { alignItems: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center' },
});
