import { StyleSheet, View } from 'react-native';
import { spacing } from '@trucaco/ui';
import { Button } from '../ui/Button';

export interface LegalLinksProps {
  onTerms(): void;
  onPrivacy(): void;
}

/** Atalhos para Termos e Privacidade (Configurações, entrada e carregamento). */
export function LegalLinks({ onTerms, onPrivacy }: LegalLinksProps) {
  return (
    <View style={styles.row}>
      <Button label="Termos de uso" variant="secondary" onPress={onTerms} testID="link-terms" />
      <Button
        label="Política de Privacidade"
        variant="secondary"
        onPress={onPrivacy}
        testID="link-privacy"
      />
    </View>
  );
}

const styles = StyleSheet.create({ row: { gap: spacing.sm } });
