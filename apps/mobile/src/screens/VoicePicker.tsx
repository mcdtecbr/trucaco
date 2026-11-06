/**
 * Escolha da voz do avatar (apresentação pura). As 9 vozes do catálogo ficam selecionáveis; as que ainda
 * não têm arquivo de áudio ganham "em breve" e, por enquanto, tocam a voz do mesmo grupo
 * (`resolveVoice`). A escolha já vale e é salva: quando os arquivos chegarem, o avatar passa a usar a voz.
 * "Ouvir" só existe para vozes com arquivo.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { VOICES, resolveVoice, voiceInfo } from '@trucaco/avatar';
import type { VoiceId } from '@trucaco/protocol';
import { MIN_TOUCH, colors, fontSize, radius, spacing } from '@trucaco/ui';
import { Body, Card, Heading } from '../ui/Typography';

export interface VoicePickerProps {
  /** Voz escolhida (já com o padrão aplicado). */
  value: VoiceId;
  disabled: boolean;
  /** Resultado do último "Ouvir" (ex.: "Som desligado."). */
  note?: string | null | undefined;
  onPick(id: VoiceId): void;
  onPreview(id: VoiceId): void;
}

/** Texto que explica por que uma voz sem arquivo ainda soa como outra. */
export function fallbackNote(id: VoiceId): string | null {
  const info = voiceInfo(id);
  if (info.hasFiles) return null;
  const used = resolveVoice(id);
  return used === null
    ? 'Em breve. Por enquanto só a legenda.'
    : `Em breve. Por enquanto toca a ${voiceInfo(used).label}.`;
}

export function VoicePicker({ value, disabled, note, onPick, onPreview }: VoicePickerProps) {
  return (
    <Card>
      <Heading>Voz</Heading>
      <View accessibilityRole="radiogroup" accessibilityLabel="Voz" style={styles.options}>
        {VOICES.map((v) => {
          const checked = v.id === value;
          const soon = fallbackNote(v.id);
          const label = soon === null ? v.label : `${v.label} (em breve)`;
          return (
            <View key={v.id} style={styles.voice}>
              <Pressable
                accessibilityRole="radio"
                accessibilityLabel={soon === null ? `Voz: ${v.label}` : `Voz: ${v.label}. ${soon}`}
                aria-checked={checked}
                accessibilityState={{ checked, disabled }}
                aria-disabled={disabled}
                disabled={disabled}
                onPress={() => onPick(v.id)}
                style={[styles.option, checked && styles.optionChecked, disabled && styles.off]}
                testID={`avatar-voice-${v.id}`}
              >
                <Text style={[styles.optionText, checked && styles.optionTextChecked]}>
                  {label}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  v.hasFiles ? `Ouvir ${v.label}` : `Ouvir ${v.label}: ainda sem amostra`
                }
                accessibilityState={{ disabled: !v.hasFiles }}
                aria-disabled={!v.hasFiles}
                disabled={!v.hasFiles}
                onPress={() => onPreview(v.id)}
                style={[styles.listen, !v.hasFiles && styles.off]}
                testID={`avatar-voice-listen-${v.id}`}
              >
                <Text style={styles.optionText}>Ouvir</Text>
              </Pressable>
            </View>
          );
        })}
      </View>
      {note !== undefined && note !== null ? <Body testID="avatar-voice-note">{note}</Body> : null}
      {fallbackNote(value) !== null ? (
        <Body muted testID="avatar-voice-soon">
          {fallbackNote(value)}
        </Body>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  options: { gap: spacing.sm },
  voice: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  option: {
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  optionChecked: { backgroundColor: colors.surfaceAlt, borderColor: colors.primary },
  listen: {
    minHeight: MIN_TOUCH,
    minWidth: MIN_TOUCH,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { color: colors.text, fontSize: fontSize.small },
  optionTextChecked: { fontWeight: '700' },
  off: { opacity: 0.5 },
});
