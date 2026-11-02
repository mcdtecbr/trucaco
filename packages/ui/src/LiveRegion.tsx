import { StyleSheet, Text, View } from 'react-native';

export interface LiveRegionProps {
  /** Texto a anunciar; mudar o valor dispara novo anúncio. */
  readonly message: string;
  /** Contador que muda a cada anúncio, para repetir a mesma frase. */
  readonly nonce?: number;
}

/**
 * Região `aria-live` para o web (leitores de tela): visualmente oculta, sempre montada. No nativo o
 * anúncio sai por `AccessibilityInfo.announceForAccessibility` (ver `useAnnouncer`); o componente é inofensivo lá.
 */
export function LiveRegion({ message, nonce = 0 }: LiveRegionProps) {
  // Alterna um espaço sem quebra para o leitor reanunciar frases idênticas em sequência.
  const text = message === '' ? '' : nonce % 2 === 0 ? message : `${message}\u00A0`;
  return (
    <View aria-live="polite" role="status" style={styles.hidden} pointerEvents="none">
      <Text>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    overflow: 'hidden',
    opacity: 0.01,
  },
});
