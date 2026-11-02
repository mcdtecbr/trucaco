import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { LiveRegion, colors, spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';
import { Body, Title } from '../ui/Typography';

/** `resuming`: voltando à mesa depois de recarregar a página ou reabrir o app. */
export type BootPhase = 'loading' | 'unavailable' | 'resuming';

export const RESUMING_TEXT = 'Reconectando à mesa…';

/** Splash: carregando, reconectando à mesa, ou servidor indisponível com botão de tentar de novo. */
export function BootView({ phase, onRetry }: { phase: BootPhase; onRetry(): void }) {
  // O leitor de tela só fala quando o texto MUDA: monta vazio e preenche no efeito.
  const [announced, setAnnounced] = useState('');
  useEffect(() => {
    setAnnounced(phase === 'resuming' ? RESUMING_TEXT : '');
  }, [phase]);

  return (
    <View style={styles.root} testID="boot">
      <Title>Trucaco</Title>
      {phase === 'loading' ? (
        <>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Carregando" />
          <Body muted>Entrando…</Body>
        </>
      ) : phase === 'resuming' ? (
        <>
          <ActivityIndicator color={colors.primary} accessibilityLabel={RESUMING_TEXT} />
          <Body testID="boot-resuming">{RESUMING_TEXT}</Body>
        </>
      ) : (
        <>
          <Body testID="boot-unavailable">
            Não foi possível falar com o servidor. Sua sessão foi mantida.
          </Body>
          <Button label="Tentar de novo" onPress={onRetry} testID="boot-retry" />
        </>
      )}
      <LiveRegion message={announced} />
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
