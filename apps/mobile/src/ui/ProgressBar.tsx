import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@trucaco/ui';

/** Barra de progresso decorativa: o valor é dito pelo texto ao lado (leitor de tela ignora a barra). */
export function ProgressBar({ ratio, done = false }: { ratio: number; done?: boolean }) {
  const pct = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%` as const;
  return (
    <View
      style={styles.track}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.fill, done && styles.done, { width: pct }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: spacing.sm,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.primary },
  done: { backgroundColor: colors.success },
});
