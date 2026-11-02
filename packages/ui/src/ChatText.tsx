import { StyleSheet, Text } from 'react-native';
import { colors, fontSize, fontWeight } from './tokens';

/** Corta por code points (não parte emoji nem par substituto) e acrescenta reticências. */
export function truncateText(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`;
}

export interface ChatTextProps {
  readonly author: string;
  readonly text: string;
  /** Máximo de code points exibidos (padrão 140, igual ao servidor). */
  readonly maxLength?: number;
  readonly testID?: string;
}

/** Linha de chat: autor e texto SEMPRE como texto (nunca HTML), truncada. */
export function ChatText({ author, text, maxLength = 140, testID }: ChatTextProps) {
  const body = truncateText(text, maxLength);
  return (
    <Text
      accessibilityLabel={`${author} disse: ${body}`}
      {...(testID !== undefined ? { testID } : {})}
      style={styles.line}
    >
      <Text style={styles.author}>{truncateText(author, 20)}: </Text>
      {body}
    </Text>
  );
}

const styles = StyleSheet.create({
  line: { color: colors.text, fontSize: fontSize.small },
  author: { fontWeight: fontWeight.bold, color: colors.textMuted },
});
