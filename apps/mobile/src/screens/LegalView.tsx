import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '@trucaco/ui';
import { parseLegal } from '../legal/parseLegal';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';

export interface LegalViewProps {
  title: string;
  /** Markdown embutido; exibido só como `<Text>`. */
  markdown: string;
  testID: string;
  onBack(): void;
}

/** Documento legal em texto simples (títulos, itens e parágrafos). Sem HTML, sem links ativos. */
export function LegalView({ title, markdown, testID, onBack }: LegalViewProps) {
  // O título da tela já é o h1 do documento: remove em qualquer posição (o aviso de rascunho vem antes).
  const blocks = parseLegal(markdown).filter((b) => !(b.kind === 'h1' && b.text === title));
  return (
    <Screen testID={testID}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.doc}>
        {blocks.map((b, i) =>
          b.kind === 'li' ? (
            <View key={i} style={[styles.item, { paddingLeft: spacing.sm + b.level * spacing.md }]}>
              <Text style={styles.bullet}>{b.marker}</Text>
              <Text style={styles.text}>{b.text}</Text>
            </View>
          ) : b.kind === 'p' ? (
            <Text key={i} style={styles.text}>
              {b.text}
            </Text>
          ) : (
            <Text
              key={i}
              accessibilityRole="header"
              style={b.kind === 'h1' ? styles.h1 : b.kind === 'h2' ? styles.h2 : styles.h3}
            >
              {b.text}
            </Text>
          ),
        )}
      </View>
      <Button label="Voltar" variant="secondary" onPress={onBack} testID="legal-back" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: fontSize.title, fontWeight: fontWeight.heavy },
  doc: { gap: spacing.sm },
  h1: { color: colors.primary, fontSize: fontSize.large, fontWeight: fontWeight.bold },
  h2: {
    color: colors.primary,
    fontSize: fontSize.large,
    fontWeight: fontWeight.bold,
    marginTop: spacing.sm,
  },
  h3: {
    color: colors.text,
    fontSize: fontSize.body,
    fontWeight: fontWeight.bold,
    marginTop: spacing.xs,
  },
  text: { color: colors.text, fontSize: fontSize.body, lineHeight: 24, flexShrink: 1 },
  item: { flexDirection: 'row', gap: spacing.sm, paddingLeft: spacing.sm },
  bullet: { color: colors.textMuted, fontSize: fontSize.body, lineHeight: 24 },
});
