import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { startCountdown, timerState } from './turn';
import { colors, fontSize, fontWeight, radius, spacing } from './tokens';

export interface TurnTimerProps {
  /** `turnDeadlineAt` do snapshot (epoch ms; 0 = sem prazo). */
  readonly deadlineAt: number;
  /** Relógio injetável (padrão `Date.now`). */
  readonly now?: () => number;
  /**
   * Diferença servidor − cliente em ms (`serverNow - Date.now()`), para o prazo `turnDeadlineAt`
   * (epoch do servidor) não adiantar nem atrasar com o relógio do aparelho errado. O 3H calcula o
   * offset (ex.: do `Date`/latência da conexão ou de uma mensagem com o horário do servidor); 0 = relógios iguais.
   */
  readonly clockOffsetMs?: number;
  readonly totalMs?: number;
}

/** Barra + contagem regressiva do turno. Só atualiza (a cada 250 ms) enquanto montada e com prazo. */
export function TurnTimer({
  deadlineAt,
  now = Date.now,
  clockOffsetMs = 0,
  totalMs,
}: TurnTimerProps) {
  const [, force] = useState(0);
  useEffect(() => {
    return startCountdown({ deadlineAt, now, clockOffsetMs, onTick: () => force((n) => n + 1) });
    // `now` injetado só muda em teste; religar a cada novo prazo ou offset.
  }, [deadlineAt, clockOffsetMs]);

  const s = timerState(deadlineAt, now() + clockOffsetMs, totalMs);
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

/** Barra fina e discreta: o timer fica no alto da tela, sem disputar atenção com as cartas. */
const TRACK = 4;

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, alignSelf: 'stretch' },
  track: {
    flex: 1,
    height: TRACK,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceAlt,
    overflow: 'hidden',
  },
  fill: { height: TRACK, borderRadius: radius.round },
  text: {
    color: colors.text,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    minWidth: spacing.lg,
    textAlign: 'right',
  },
  urgent: { color: colors.danger },
});
