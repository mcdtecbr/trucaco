import { StyleSheet, Text, View } from 'react-native';
import { truncateText } from './ChatText';
import { colors, fontSize, fontWeight, radius, spacing } from './tokens';

/** Tempo que a legenda da fala (grito, "quero", "corro") fica sobre o avatar. */
export const SPEECH_BUBBLE_MS = 2000;
/** Máximo de code points da legenda (os takes do catálogo são curtos). */
export const SPEECH_BUBBLE_MAX = 40;

export interface SpeechBubbleProps {
  readonly author: string;
  readonly text: string;
  readonly testID?: string;
}

/**
 * Legenda grande da fala do avatar ("TRUCO!"). Maior e mais chamativa que o `ChatBubble`, para não ser
 * confundida com chat. O texto SEMPRE como `<Text>` (nunca HTML), truncado.
 */
export function SpeechBubble({ author, text, testID }: SpeechBubbleProps) {
  const body = truncateText(text, SPEECH_BUBBLE_MAX);
  return (
    <View
      accessible
      style={styles.bubble}
      {...(testID !== undefined ? { testID } : {})}
      accessibilityLabel={`${author} gritou: ${body}`}
    >
      <Text style={styles.text}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'center',
    maxWidth: 200,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.onPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: {
    color: colors.onPrimary,
    fontSize: fontSize.large,
    fontWeight: fontWeight.heavy,
    textAlign: 'center',
  },
});
