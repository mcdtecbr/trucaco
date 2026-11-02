import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { startTicker, timerState } from './turn';
import { colors, fontSize, fontWeight, radius, spacing } from './tokens';

export interface TurnTimerProps {
  /** `turnDeadlineAt` do snapshot (epoch ms; 0 = sem prazo). */
  readonly deadlineAt: number;
  /** Relógio injetável (padrão `Date.now`). */
  readonly now?: () => number;
  readonly totalMs?: number;
}

/** Barra + contagem regressiva do turno. Só atualiza (a cada 250 ms) enquanto montada e com prazo. */
export function TurnTimer({ deadlineAt, now = Date.now, totalMs }: TurnTimerProps) {
  const [, force] = useState(0);
  useEffect(() => {
    if (deadlineAt <= 0) return undefined;
    return startTicker(() => force((n) => n + 1));
  }, [deadlineAt]);

  const s = timerState(deadlineAt, now(), totalMs);
  if (!s.active) return null;
  const pct = Math.round(s.fraction * 100);
  return (
    <View
      accessibilityRole="timer"
      accessibilityLabel={`Tempo restante: ${s.seconds} ${s.seconds === 1 ? 'segundo' : 'segundos'}`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      style={styles.wrap}
    >
      <View style={styles.track} importantForAccessibility="no-hide-descendants">
        <View
          style={[
            styles.fill,
            { width: `${pct}%`, backgroundColor: s.urgent ? colors.danger : colors.primary },
          ]}
        />
      </View>
      <Text style={[styles.text, s.urgent && styles.urgent]}>{s.seconds} s</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'stretch' },
  track: {
    flex: 1,
    height: spacing.sm,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: spacing.sm, borderRadius: radius.round },
  text: {
    color: colors.text,
    fontSize: fontSize.small,
    fontWeight: fontWeight.bold,
    minWidth: spacing.xl,
    textAlign: 'right',
  },
  urgent: { color: colors.danger },
});
