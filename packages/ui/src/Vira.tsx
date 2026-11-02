import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { cardName, parseFace } from './cardInfo';
import { colors, fontSize, fontWeight, spacing } from './tokens';

export interface ViraProps {
  /** Valores do snapshot (`''` = variante sem vira). */
  readonly viraRank: string;
  readonly viraSuit: string;
  /**
   * Manilha pronta, se o servidor a fornecer. O snapshot atual (`HandSnapshot`) só traz a vira:
   * o cliente NÃO deriva a manilha (regra de jogo). Sem a prop, só a vira é mostrada.
   */
  readonly manilhaLabel?: string;
}

export function Vira(p: ViraProps) {
  const face = parseFace({ rank: p.viraRank, suit: p.viraSuit });
  if (face === null) return null;
  return (
    <View
      accessible
      accessibilityLabel={`Vira: ${cardName(face.rank, face.suit)}${p.manilhaLabel !== undefined ? `. Manilha: ${p.manilhaLabel}` : ''}`}
      style={styles.wrap}
    >
      <Text style={styles.caption}>Vira</Text>
      <Card size="sm" rank={face.rank} suit={face.suit} accessibilityLabel="Vira" />
      {p.manilhaLabel !== undefined ? (
        <Text style={styles.caption}>Manilha: {p.manilhaLabel}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: spacing.xs },
  caption: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: fontWeight.bold },
});
