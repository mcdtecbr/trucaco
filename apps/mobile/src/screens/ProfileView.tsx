import { Avatar } from '@trucaco/avatar';
import type { AuthProvider, AvatarParts, UserStats } from '@trucaco/protocol';
import { colors, fontSize, spacing } from '@trucaco/ui';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';
import { PROVIDER_LABEL, RELATION_LABEL, hasStats, statLine } from '../profile/history';
import type { HistoryRow } from '../profile/history';
import { ModerationPanel } from './ModerationPanel';
import type { ModerationPanelProps, ModerationState } from './ModerationPanel';
import { SocialAuthPanel } from './SocialAuthPanel';
import type { SocialAuthPanelProps } from './SocialAuthPanel';

export type LoadState = 'loading' | 'ready' | 'error';

export const STATS_SOON_TEXT = 'Estatísticas em breve.';
export const HISTORY_EMPTY_TEXT = 'Você ainda não jogou nenhuma partida.';

export interface ProfileViewProps {
  nickname: string | null;
  provider: AuthProvider | null;
  avatar: AvatarParts | null;
  reduceMotion: boolean;
  /** Estado do `GET /me` (avatar e estatísticas). */
  me: { state: LoadState; error: string | null; stats: UserStats | null };
  history: {
    state: LoadState;
    rows: readonly HistoryRow[];
    hasMore: boolean;
    loadingMore: boolean;
    error: string | null;
  };
  moderation: ModerationState | null;
  /** Vincular conta (só aparece para convidado). Omitido = sem o cartão. */
  social?: SocialAuthPanelProps;
  on: {
    back(): void;
    retryMe(): void;
    retryHistory(): void;
    loadMore(): void;
    block(userId: string, nickname: string, matchId: string): void;
    report(userId: string, nickname: string, matchId: string): void;
    moderation: ModerationPanelProps['on'];
    achievements?(): void;
    missions?(): void;
    viewPlayer?(userId: string): void;
  };
}

const AVATAR_SIZE = 72;

export function ProfileView(p: ProfileViewProps) {
  return (
    <Screen testID="profile">
      <Title>Meu perfil</Title>
      <Card>
        <View style={styles.identity}>
          {p.avatar !== null ? (
            <Avatar
              parts={p.avatar}
              size={AVATAR_SIZE}
              reduceMotion={p.reduceMotion}
              accessibilityLabel="Seu avatar"
              testID="profile-avatar"
            />
          ) : null}
          <View style={styles.identityText}>
            <Heading>{p.nickname ?? 'Jogador'}</Heading>
            <Body muted testID="profile-provider">
              {p.provider !== null ? PROVIDER_LABEL[p.provider] : 'Tipo de conta indisponível'}
            </Body>
          </View>
        </View>
      </Card>

      {p.provider === 'guest' && p.social !== undefined ? (
        <Card>
          <Heading>Vincular conta</Heading>
          <SocialAuthPanel {...p.social} />
        </Card>
      ) : null}

      {p.on.achievements !== undefined || p.on.missions !== undefined ? (
        <Card>
          <Heading>Progresso</Heading>
          {p.on.achievements !== undefined ? (
            <Button
              label="Conquistas"
              variant="secondary"
              onPress={p.on.achievements}
              testID="profile-achievements"
            />
          ) : null}
          {p.on.missions !== undefined ? (
            <Button
              label="Missões"
              variant="secondary"
              onPress={p.on.missions}
              testID="profile-missions"
            />
          ) : null}
        </Card>
      ) : null}

      <Card>
        <Heading>Estatísticas</Heading>
        {p.me.state === 'loading' ? <Body muted>Carregando…</Body> : null}
        {p.me.state === 'error' ? (
          <>
            <ErrorText testID="profile-me-error">{p.me.error ?? ''}</ErrorText>
            <Button
              label="Tentar de novo"
              variant="secondary"
              onPress={p.on.retryMe}
              testID="profile-me-retry"
            />
          </>
        ) : null}
        {p.me.state === 'ready' && p.me.stats !== null && hasStats(p.me.stats) ? (
          <View testID="profile-stats">
            <Body>{statLine('paulista', p.me.stats)}</Body>
            <Body>{statLine('mineiro', p.me.stats)}</Body>
          </View>
        ) : null}
        {p.me.state === 'ready' && !hasStats(p.me.stats) ? (
          <Body muted testID="profile-stats-soon">
            {STATS_SOON_TEXT}
          </Body>
        ) : null}
      </Card>

      <Heading>Histórico de partidas</Heading>
      {p.history.state === 'loading' ? (
        <Body muted testID="history-loading">
          Carregando…
        </Body>
      ) : null}
      {p.history.state === 'error' ? (
        <Card>
          <ErrorText testID="history-error">{p.history.error ?? ''}</ErrorText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            onPress={p.on.retryHistory}
            testID="history-retry"
          />
        </Card>
      ) : null}
      {p.history.state === 'ready' && p.history.rows.length === 0 ? (
        <Body muted testID="history-empty">
          {HISTORY_EMPTY_TEXT}
        </Body>
      ) : null}
      {p.history.rows.map((row) => (
        <HistoryItem key={row.id} row={row} p={p} />
      ))}
      {p.history.state === 'ready' && p.history.hasMore ? (
        <>
          {p.history.error !== null ? (
            <ErrorText testID="history-more-error">{p.history.error}</ErrorText>
          ) : null}
          <Button
            label={p.history.loadingMore ? 'Carregando…' : 'Carregar mais'}
            variant="secondary"
            onPress={p.on.loadMore}
            disabled={p.history.loadingMore}
            testID="history-more"
          />
        </>
      ) : null}

      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="profile-back" />
    </Screen>
  );
}

function HistoryItem({ row, p }: { row: HistoryRow; p: ProfileViewProps }) {
  const mod = p.moderation;
  const details = [row.scoreLabel, row.dateLabel, row.durationLabel].filter(
    (x): x is string => x !== null,
  );
  return (
    <Card>
      <View
        accessible
        accessibilityLabel={`${row.title}. ${row.outcomeLabel}. ${details.join('. ')}`}
        testID={`history-${row.id}`}
      >
        <Text style={styles.rowTitle}>{row.title}</Text>
        <Text style={[styles.outcome, row.outcome === 'won' && styles.won]}>
          {row.outcomeLabel}
        </Text>
        {details.map((d) => (
          <Text key={d} style={styles.detail}>
            {d}
          </Text>
        ))}
      </View>
      {row.players.map((pl) => (
        <View key={pl.seat} style={styles.player}>
          <Text style={styles.playerName}>{`${pl.name} · ${RELATION_LABEL[pl.relation]}`}</Text>
          {pl.userId !== null ? (
            <View style={styles.playerActions}>
              {p.on.viewPlayer !== undefined ? (
                <Button
                  label={`Ver perfil de ${pl.name}`}
                  variant="secondary"
                  onPress={() => p.on.viewPlayer?.(pl.userId as string)}
                  testID={`view-${row.id}-${pl.seat}`}
                />
              ) : null}
              <Button
                label={`Bloquear ${pl.name}`}
                variant="secondary"
                onPress={() => p.on.block(pl.userId as string, pl.name, row.id)}
                testID={`block-${row.id}-${pl.seat}`}
              />
              <Button
                label={`Denunciar ${pl.name}`}
                variant="secondary"
                onPress={() => p.on.report(pl.userId as string, pl.name, row.id)}
                testID={`report-${row.id}-${pl.seat}`}
              />
            </View>
          ) : null}
          {mod !== null && mod.target.matchId === row.id && mod.target.userId === pl.userId ? (
            <ModerationPanel state={mod} on={p.on.moderation} />
          ) : null}
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityText: { flex: 1, gap: spacing.xs },
  rowTitle: { color: colors.text, fontSize: fontSize.body, fontWeight: '700' },
  outcome: { color: colors.textMuted, fontSize: fontSize.body },
  won: { color: colors.success },
  detail: { color: colors.textMuted, fontSize: fontSize.small },
  player: { gap: spacing.xs, paddingTop: spacing.sm },
  playerName: { color: colors.text, fontSize: fontSize.small },
  playerActions: { gap: spacing.xs },
});
