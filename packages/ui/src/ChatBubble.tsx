import { StyleSheet, Text, View } from 'react-native';
import { truncateText } from './ChatText';
import { colors, fontSize, fontWeight, radius, spacing } from './tokens';

/** Tempo que o balão fica sobre o avatar. */
export const CHAT_BUBBLE_MS = 4000;
/** Máximo de code points no balão (o texto completo fica no painel de chat). */
export const CHAT_BUBBLE_MAX = 80;

export interface ChatBubbleProps {
  readonly author: string;
  readonly text: string;
  /** Mensagem da dupla (privada): ganha um rótulo para não ser confundida com a da mesa. */
  readonly partner?: boolean;
  readonly testID?: string;
}

/** Balão de chat sobre o avatar. O texto SEMPRE como `<Text>` (nunca HTML), truncado. */
export function ChatBubble({ author, text, partner = false, testID }: ChatBubbleProps) {
  const body = truncateText(text, CHAT_BUBBLE_MAX);
  return (
    <View
      accessible
      style={[styles.bubble, partner && styles.partner]}
      {...(testID !== undefined ? { testID } : {})}
      accessibilityLabel={`${author} disse${partner ? ' à dupla' : ''}: ${body}`}
    >
      {partner ? <Text style={styles.tag}>Dupla</Text> : null}
      <Text style={styles.text}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: {
    alignSelf: 'center',
    maxWidth: 160,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  partner: { borderColor: colors.primary },
  tag: { color: colors.primary, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
  text: { color: colors.text, fontSize: fontSize.small },
});
