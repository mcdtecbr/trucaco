import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, spacing } from '../theme';

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Heading({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.heading}>
      {children}
    </Text>
  );
}

export function Body({
  children,
  muted = false,
  testID,
}: {
  children: ReactNode;
  muted?: boolean;
  testID?: string;
}) {
  return (
    <Text
      {...(testID !== undefined ? { testID } : {})}
      style={[styles.body, muted && styles.muted]}
    >
      {children}
    </Text>
  );
}

/** Erro anunciado por leitores de tela. O texto vem de `i18n/errors`, nunca cru do servidor. */
export function ErrorText({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      {...(testID !== undefined ? { testID } : {})}
      style={styles.error}
    >
      {children}
    </Text>
  );
}

export function Notice({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      {...(testID !== undefined ? { testID } : {})}
      style={styles.notice}
    >
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.title, fontWeight: '800' },
  heading: { color: colors.text, fontSize: fontSize.body + 2, fontWeight: '700' },
  body: { color: colors.text, fontSize: fontSize.body },
  muted: { color: colors.textMuted },
  error: { color: colors.danger, fontSize: fontSize.body },
  notice: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, padding: spacing.md },
  noticeText: { color: colors.text, fontSize: fontSize.body },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
});
