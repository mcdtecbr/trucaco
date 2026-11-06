import { StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '@trucaco/ui';
import { achievementRows } from '../profile/progress';
import type { AchievementRow } from '../profile/progress';
import type { UserAchievement } from '@trucaco/protocol';
import { Button } from '../ui/Button';
import { ProgressBar } from '../ui/ProgressBar';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';
import type { LoadState } from './ProfileView';

export interface AchievementsViewProps {
  state: LoadState;
  error: string | null;
  items: readonly UserAchievement[];
  on: { retry(): void; back(): void };
}

/** Conquistas do próprio jogador: todas as do catálogo, com nível e progresso. Só texto do servidor tipado. */
export function AchievementsView(p: AchievementsViewProps) {
  const rows = achievementRows(p.items);
  const unlocked = rows.filter((r) => r.unlocked).length;
  return (
    <Screen testID="achievements">
      <Title>Conquistas</Title>
      {p.state === 'loading' ? (
        <Body muted testID="achievements-loading">
          Carregando…
        </Body>
      ) : null}
      {p.state === 'error' ? (
        <Card>
          <ErrorText testID="achievements-error">{p.error ?? ''}</ErrorText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            onPress={p.on.retry}
            testID="achievements-retry"
          />
        </Card>
      ) : null}
      {p.state === 'ready' ? (
        <>
          <Body
            muted
            testID="achievements-count"
          >{`${unlocked} de ${rows.length} desbloqueadas`}</Body>
          {rows.map((r) => (
            <AchievementCard key={r.id} row={r} />
          ))}
        </>
      ) : null}
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="achievements-back" />
    </Screen>
  );
}

function AchievementCard({ row }: { row: AchievementRow }) {
  return (
    <Card>
      <View accessible accessibilityLabel={row.accessibilityLabel} testID={`achievement-${row.id}`}>
        <Heading>{row.name}</Heading>
        <Text style={styles.detail}>{row.description}</Text>
        <Text style={[styles.level, row.unlocked && styles.levelOn]}>{row.levelLabel}</Text>
        <ProgressBar ratio={row.ratio} done={row.ratio >= 1} />
        <Text style={styles.detail}>{row.progressLabel}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  detail: { color: colors.textMuted, fontSize: fontSize.small, marginTop: spacing.xs },
  level: {
    color: colors.textMuted,
    fontSize: fontSize.small,
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  levelOn: { color: colors.primary },
});
