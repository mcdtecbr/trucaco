import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../theme';

/** Primeira letra do apelido (code point inteiro), ou `?` se vazio. Texto puro. */
export function initialOf(nickname: string): string {
  const first = [...nickname.trim()][0];
  return first === undefined ? '?' : first.toUpperCase();
}

/** Círculo com inicial e apelido (o avatar Rive entra na Fase 4). Apelido sempre em `<Text>`. */
export function AvatarPlaceholder({
  nickname,
  caption,
  testID,
}: {
  nickname: string;
  caption?: string;
  testID?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={`${nickname}${caption !== undefined ? `, ${caption}` : ''}`}
      {...(testID !== undefined ? { testID } : {})}
      style={styles.wrap}
    >
      <View style={styles.circle}>
        <Text style={styles.initial}>{initialOf(nickname)}</Text>
      </View>
      <View style={styles.texts}>
        <Text style={styles.nick} numberOfLines={1}>
          {nickname}
        </Text>
        {caption !== undefined ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    </View>
  );
}

const SIZE = 48;
const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56 },
  circle: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.round,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: { color: colors.onPrimary, fontSize: fontSize.title, fontWeight: '800' },
  texts: { flexShrink: 1 },
  nick: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  caption: { color: colors.textMuted, fontSize: fontSize.small },
});
