import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { MAX_COLUMN_WIDTH, colors, spacing } from '../theme';

/** Coluna central (largura máxima ~480 no web), com rolagem. */
export function Screen({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      {...(testID !== undefined ? { testID } : {})}
    >
      <View style={styles.column}>{children}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { flexGrow: 1, alignItems: 'center', padding: spacing.md },
  column: { width: '100%', maxWidth: MAX_COLUMN_WIDTH, gap: spacing.md },
});
