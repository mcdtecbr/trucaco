import { StyleSheet, Text, View } from 'react-native';
import { colors, describeHandResult, defaultTeamNames, fontSize, spacing } from '@trucaco/ui';
import type { HandResult } from '@trucaco/ui';
import type { FinishedResult } from '../table/tableRoute';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, Title } from '../ui/Typography';

export interface FinishedViewProps {
  result: FinishedResult;
  /** Dupla do jogador local, para os nomes "Nós"/"Eles" do histórico. */
  myTeam: 0 | 1;
  history: readonly HandResult[];
  onLeave(): void;
}

/** Fim da partida ou da série: resultado, placares, histórico das mãos do último jogo e saída. */
export function FinishedView({ result, myTeam, history, onLeave }: FinishedViewProps) {
  const names = defaultTeamNames(myTeam);
  return (
    <Screen testID="table-finished">
      <Title>Partida encerrada</Title>
      <Card>
        <Text
          accessibilityRole="header"
          style={styles.result}
          testID={`finished-${result.outcome}`}
        >
          {result.title}
        </Text>
        {result.outcome === 'cancelled' ? (
          <Body muted>Os jogadores votaram para cancelar. Nenhum resultado foi registrado.</Body>
        ) : null}
        {result.lines.map((l, i) => (
          <Body key={i} muted>
            {l}
          </Body>
        ))}
      </Card>
      {history.length > 0 ? (
        <Card>
          <Text accessibilityRole="header" style={styles.sub}>
            Mãos do último jogo
          </Text>
          <View accessibilityRole="list" style={styles.list} testID="finished-history">
            {history.map((r) => (
              <Text key={r.handNumber} style={styles.line}>
                {describeHandResult(r, names)}
              </Text>
            ))}
          </View>
        </Card>
      ) : null}
      <Button label="Voltar ao início" onPress={onLeave} testID="leave-table" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { color: colors.text, fontSize: fontSize.large, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: '700' },
  list: { gap: spacing.xs },
  line: { color: colors.text, fontSize: fontSize.small },
});
