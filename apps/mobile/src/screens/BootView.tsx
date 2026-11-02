import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { colors, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { Body, Title } from '../ui/Typography';

export type BootPhase = 'loading' | 'unavailable';

/** Splash: carregando, ou servidor indisponível com botão de tentar de novo. */
export function BootView({ phase, onRetry }: { phase: BootPhase; onRetry(): void }) {
  return (
    <View style={styles.root} testID="boot">
      <Title>Trucaco</Title>
      {phase === 'loading' ? (
        <>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Carregando" />
          <Body muted>Entrando…</Body>
        </>
      ) : (
        <>
          <Body testID="boot-unavailable">
            Não foi possível falar com o servidor. Sua sessão foi mantida.
          </Body>
          <Button label="Tentar de novo" onPress={onRetry} testID="boot-retry" />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
});
