import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { screenPosition } from '@trucaco/ui';
import { signalTrigger } from '@trucaco/avatar';
import { StyleSheet, Text, View } from 'react-native';

/** Tela mínima do esqueleto (bloco 3C): prova a resolução dos pacotes workspace pelo Metro. */
export function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text accessibilityRole="header" style={styles.title}>
        Trucaco
      </Text>
      <Text>Protocolo v{PROTOCOL_VERSION}</Text>
      <Text>
        ui: {screenPosition(0, 2)} / avatar: {signalTrigger('wink')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  title: { fontSize: 32, fontWeight: '700' },
});
