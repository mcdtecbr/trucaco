/**
 * Cartão "Som" das Configurações (apresentação pura): volume das vozes e dos efeitos em passos de 10%
 * (botões - e +, acessíveis sem arrastar), "sem som" geral e "silenciar efeitos engraçados". Tudo fica só
 * neste aparelho (`AudioService`); a legenda dos gritos continua com o som desligado.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MIN_TOUCH, colors, fontSize, fontWeight, radius, spacing } from '@trucaco/ui';
import type { AudioPrefs } from '../audio/prefs';
import { Body, Card, Heading } from '../ui/Typography';

/** Passo do volume (fração de 0 a 1). */
export const VOLUME_STEP = 0.1;

/** Próximo volume, preso em 0..1 e sem erro de ponto flutuante (0.1 + 0.2). */
export function stepVolume(v: number, dir: 1 | -1): number {
  const next = Math.round((v + dir * VOLUME_STEP) * 10) / 10;
  return Math.min(1, Math.max(0, next));
}

export interface SoundSettingsProps {
  prefs: AudioPrefs;
  onChange(patch: Partial<AudioPrefs>): void;
}

function Stepper({
  title,
  value,
  disabled,
  onChange,
  testID,
}: {
  title: string;
  value: number;
  disabled: boolean;
  onChange(v: number): void;
  testID: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <View style={styles.row} testID={testID} accessibilityRole="adjustable">
      <Text style={styles.label}>{title}</Text>
      <View style={styles.stepper}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Diminuir ${title.toLowerCase()}`}
          aria-disabled={disabled || value <= 0}
          disabled={disabled || value <= 0}
          onPress={() => onChange(stepVolume(value, -1))}
          style={[styles.step, (disabled || value <= 0) && styles.off]}
          testID={`${testID}-down`}
        >
          <Text style={styles.stepText}>-</Text>
        </Pressable>
        <Text
          style={styles.value}
          testID={`${testID}-value`}
          accessibilityLabel={`${title}: ${pct} por cento`}
        >
          {pct}%
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Aumentar ${title.toLowerCase()}`}
          aria-disabled={disabled || value >= 1}
          disabled={disabled || value >= 1}
          onPress={() => onChange(stepVolume(value, 1))}
          style={[styles.step, (disabled || value >= 1) && styles.off]}
          testID={`${testID}-up`}
        >
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Toggle({
  title,
  hint,
  on,
  onToggle,
  testID,
}: {
  title: string;
  hint: string;
  on: boolean;
  onToggle(): void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={hint}
      accessibilityState={{ checked: on }}
      aria-checked={on}
      onPress={onToggle}
      style={[styles.toggle, on && styles.toggleOn]}
      testID={testID}
    >
      <View style={styles.toggleText}>
        <Text style={styles.label}>{title}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
      <Text style={styles.state}>{on ? 'Ligado' : 'Desligado'}</Text>
    </Pressable>
  );
}

export function SoundSettings({ prefs, onChange }: SoundSettingsProps) {
  return (
    <Card>
      <Heading>Som</Heading>
      <Body muted>Vale só neste aparelho. A legenda dos gritos aparece mesmo sem som.</Body>
      <Toggle
        title="Sem som"
        hint="Desliga vozes e efeitos."
        on={prefs.muted}
        onToggle={() => onChange({ muted: !prefs.muted })}
        testID="sound-muted"
      />
      <Stepper
        title="Volume das vozes"
        value={prefs.voiceVolume}
        disabled={false}
        onChange={(v) => onChange({ voiceVolume: v })}
        testID="sound-voice"
      />
      <Stepper
        title="Volume dos efeitos"
        value={prefs.sfxVolume}
        disabled={false}
        onChange={(v) => onChange({ sfxVolume: v })}
        testID="sound-sfx"
      />
      <Toggle
        title="Silenciar efeitos engraçados"
        hint="Some só o painel de efeitos; os gritos continuam."
        on={prefs.funnyMuted}
        onToggle={() => onChange({ funnyMuted: !prefs.funnyMuted })}
        testID="sound-funny-muted"
      />
      <Body muted>
        Para silenciar um jogador específico, use o botão Silenciar no chat da mesa: vale para o
        chat, a voz e os efeitos dele.
      </Body>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  label: { color: colors.text, fontSize: fontSize.body, fontWeight: fontWeight.bold },
  hint: { color: colors.textMuted, fontSize: fontSize.small },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  step: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  stepText: { color: colors.text, fontSize: fontSize.large, fontWeight: fontWeight.bold },
  value: {
    color: colors.text,
    fontSize: fontSize.body,
    minWidth: 56,
    textAlign: 'center',
  },
  toggle: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  toggleOn: { borderColor: colors.primary, backgroundColor: colors.surfaceAlt },
  toggleText: { flex: 1, gap: spacing.xs },
  state: { color: colors.text, fontSize: fontSize.small, fontWeight: fontWeight.bold },
  off: { opacity: 0.5 },
});
