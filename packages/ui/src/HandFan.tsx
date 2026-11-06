import { StyleSheet, View } from 'react-native';
import type { LegalActionId, Rank, Suit } from '@trucaco/protocol';
import { Card, cardLabel } from './Card';
import { blindActions, handCardViews } from './handActions';
import { spacing } from './tokens';
import type { CardSize } from './tokens';

export interface HandFanProps {
  readonly hand: readonly { readonly rank: string; readonly suit: string }[];
  /** Ids de `legalActions` do servidor; cartas fora da lista ficam desabilitadas. */
  readonly legalActions: readonly string[];
  /** Mão de ferro: sem identidade, `blindCount` versos com "?" selecionáveis (`playBlind:<i>`). */
  readonly blindCount?: number;
  /** Jogar a próxima carta coberta (usa `playCovered:` em vez de `play:`). */
  readonly coverMode?: boolean;
  /** Manilhas vindas do estado/servidor, só para o destaque visual. */
  readonly manilhas?: readonly { readonly rank: Rank; readonly suit: Suit }[];
  readonly selectedAction?: string | null;
  readonly size?: CardSize;
  readonly onPress: (actionId: LegalActionId) => void;
}

/** Leque da mão do jogador local. */
export function HandFan(p: HandFanProps) {
  const size = p.size ?? 'md';
  const blind = p.blindCount ?? 0;
  const n = blind > 0 ? Math.min(3, blind) : p.hand.length;
  const tilt = (i: number): number => (i - (n - 1) / 2) * 4;
  const lift = (i: number): number => Math.abs(i - (n - 1) / 2) * 3;

  let cards;
  if (blind > 0) {
    const acts = blindActions(blind, p.legalActions);
    cards = acts.map((id, i) => (
      <View key={i} style={slot(tilt(i), lift(i))}>
        <Card
          unknown
          size={size}
          accessibilityLabel={`Carta ${i + 1} de ${acts.length}, às cegas`}
          disabled={id === null}
          selected={id !== null && p.selectedAction === id}
          {...(id !== null ? { onPress: () => p.onPress(id) } : { onPress: noop })}
        />
      </View>
    ));
  } else {
    cards = handCardViews(p.hand, p.legalActions).map((v) => {
      const id = p.coverMode === true ? v.playCovered : v.play;
      const manilha =
        v.face !== null &&
        (p.manilhas ?? []).some((m) => m.rank === v.face?.rank && m.suit === v.face.suit);
      return (
        <View key={v.index} style={slot(tilt(v.index), lift(v.index))}>
          <Card
            size={size}
            {...(v.face !== null ? { rank: v.face.rank, suit: v.face.suit } : {})}
            manilha={manilha}
            {...(p.coverMode === true && v.face !== null
              ? {
                  accessibilityLabel: `Jogar coberta: ${cardLabel({ rank: v.face.rank, suit: v.face.suit, manilha })}`,
                }
              : {})}
            disabled={id === null}
            selected={id !== null && p.selectedAction === id}
            onPress={id !== null ? () => p.onPress(id) : noop}
          />
        </View>
      );
    });
  }

  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Sua mão" style={styles.row}>
      {cards}
    </View>
  );
}

function noop(): void {}

function slot(rotateDeg: number, lift: number) {
  return {
    marginHorizontal: -spacing.xs,
    transform: [{ rotate: `${rotateDeg}deg` }, { translateY: lift }],
  };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-end' },
});
