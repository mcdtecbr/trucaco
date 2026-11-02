import { StyleSheet, Text, View } from 'react-native';
import { colors, describeHandResult, defaultTeamNames, fontSize, spacing } from '@trucaco/ui';
import type { HandResult } from '@trucaco/ui';
import type { FinishedResult, RematchView } from '../table/tableRoute';
import { secondsLeft } from '../table/tableRoute';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, Title } from '../ui/Typography';
import { useNow } from './useNow';

export interface FinishedViewProps {
  result: FinishedResult;
  /** Dupla do jogador local, para os nomes "Nós"/"Eles" do histórico. */
  myTeam: 0 | 1;
  history: readonly HandResult[];
  onLeave(): void;
  /** Janela de revanche (servidor); `null`/ausente = sem botão "Jogar de novo". */
  rematch?: RematchView | null;
  /** Servidor − cliente em ms, para o prazo da revanche. */
  clockOffsetMs?: number;
  /** Erro traduzido do último `error` do servidor. */
  errorText?: string | null;
  onRematch?(): void;
}

/** Fim da partida ou da série: resultado, placares, histórico das mãos do último jogo, revanche e saída. */
export function FinishedView({
  result,
  myTeam,
  history,
  onLeave,
  rematch = null,
  clockOffsetMs = 0,
  errorText = null,
  onRematch,
}: FinishedViewProps) {
  const names = defaultTeamNames(myTeam);
  const now = useNow(rematch !== null);
  const left = rematch === null ? 0 : secondsLeft(rematch.deadlineAt, now, clockOffsetMs);
  const expired = rematch !== null && left <= 0;
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
      {rematch !== null ? (
        <Card>
          <View testID="rematch-panel" style={styles.list}>
            <Button
              label={
                rematch.iVoted
                  ? `Aguardando a mesa (${rematch.votes} ${rematch.votes === 1 ? 'votou' : 'votaram'})`
                  : 'Jogar de novo'
              }
              onPress={() => onRematch?.()}
              disabled={!rematch.canVote || expired || onRematch === undefined}
              testID="rematch"
            />
            {expired ? (
              <Body muted>O tempo para jogar de novo acabou.</Body>
            ) : (
              <Body muted>{`Tempo para decidir: ${left} s`}</Body>
            )}
            <Body muted>A revanche precisa de pelo menos 2 jogadores conectados.</Body>
            {rematch.voters.length > 0 ? (
              <Body muted>{`Querem jogar de novo: ${rematch.voters.join(', ')}`}</Body>
            ) : null}
            {errorText !== null ? (
              <Text accessibilityRole="alert" style={styles.error} testID="rematch-error">
                {errorText}
              </Text>
            ) : null}
          </View>
        </Card>
      ) : null}
      <Button
        label="Voltar ao início"
        onPress={onLeave}
        testID="leave-table"
        variant={rematch !== null ? 'secondary' : 'primary'}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { color: colors.text, fontSize: fontSize.large, fontWeight: '800' },
  sub: { color: colors.textMuted, fontSize: fontSize.small, fontWeight: '700' },
  list: { gap: spacing.xs },
  line: { color: colors.text, fontSize: fontSize.small },
  error: { color: colors.danger, fontSize: fontSize.small },
});
