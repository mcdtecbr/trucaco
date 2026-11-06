import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '@trucaco/ui';
import type { UserMission } from '@trucaco/protocol';
import { missionGroups } from '../profile/progress';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';
import type { LoadState } from './ProfileView';

export const MISSIONS_EMPTY_TEXT = 'Nenhuma missão por enquanto. Volte mais tarde.';
export const MISSIONS_RENEW_TEXT =
  'As missões do dia renovam à meia-noite (horário de Brasília); a da semana, na segunda-feira.';

export interface MissionsViewProps {
  state: LoadState;
  error: string | null;
  items: readonly UserMission[];
  on: { retry(): void; back(): void };
}

/** Missões diárias e semanal, com progresso. */
export function MissionsView(p: MissionsViewProps) {
  const groups = missionGroups(p.items);
  return (
    <Screen testID="missions">
      <Title>Missões</Title>
      {p.state === 'loading' ? (
        <Body muted testID="missions-loading">
          Carregando…
        </Body>
      ) : null}
      {p.state === 'error' ? (
        <Card>
          <ErrorText testID="missions-error">{p.error ?? ''}</ErrorText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            onPress={p.on.retry}
            testID="missions-retry"
          />
        </Card>
      ) : null}
      {p.state === 'ready' && groups.length === 0 ? (
        <Body muted testID="missions-empty">
          {MISSIONS_EMPTY_TEXT}
        </Body>
      ) : null}
      {p.state === 'ready'
        ? groups.map((g) => (
            <Card key={g.period}>
              <Heading>{g.label}</Heading>
              {g.rows.map((r) => (
                <View
                  key={r.key}
                  accessible
                  accessibilityLabel={r.accessibilityLabel}
                  style={styles.row}
                  testID={`mission-${r.key}`}
                >
                  <Text style={styles.title}>{r.title}</Text>
                  <ProgressBar ratio={r.ratio} done={r.done} />
                  <Text style={[styles.detail, r.done && styles.done]}>{r.progressLabel}</Text>
                </View>
              ))}
            </Card>
          ))
        : null}
      {p.state === 'ready' ? <Body muted>{MISSIONS_RENEW_TEXT}</Body> : null}
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="missions-back" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.xs },
  title: { color: colors.text, fontSize: fontSize.body },
  detail: { color: colors.textMuted, fontSize: fontSize.small },
  done: { color: colors.success },
});
