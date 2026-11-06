import { Avatar } from '@trucaco/avatar';
import type { AvatarParts, UserStats } from '@trucaco/protocol';
import { spacing } from '@trucaco/ui';
import { StyleSheet, View } from 'react-native';
import { hasStats, statLine } from '../profile/history';
import { publicAchievementLines } from '../profile/progress';
import type { PublicAchievement } from '@trucaco/protocol';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';
import type { LoadState } from './ProfileView';

export interface PublicProfile {
  nickname: string;
  avatar: AvatarParts | null;
  achievements: readonly PublicAchievement[];
  stats: UserStats;
}

export interface PublicProfileViewProps {
  state: LoadState;
  error: string | null;
  profile: PublicProfile | null;
  reduceMotion: boolean;
  on: { retry(): void; back(): void };
}

const AVATAR_SIZE = 72;

/** Perfil de outro jogador: apelido, avatar, medalhas e partidas por variante. Nunca histórico. */
export function PublicProfileView(p: PublicProfileViewProps) {
  const lines = p.profile === null ? [] : publicAchievementLines(p.profile.achievements);
  return (
    <Screen testID="public-profile">
      <Title>Perfil do jogador</Title>
      {p.state === 'loading' ? (
        <Body muted testID="public-profile-loading">
          Carregando…
        </Body>
      ) : null}
      {p.state === 'error' ? (
        <Card>
          <ErrorText testID="public-profile-error">{p.error ?? ''}</ErrorText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            onPress={p.on.retry}
            testID="public-profile-retry"
          />
        </Card>
      ) : null}
      {p.state === 'ready' && p.profile !== null ? (
        <>
          <Card>
            <View style={styles.identity}>
              {p.profile.avatar !== null ? (
                <Avatar
                  parts={p.profile.avatar}
                  size={AVATAR_SIZE}
                  reduceMotion={p.reduceMotion}
                  accessibilityLabel={`Avatar de ${p.profile.nickname}`}
                  testID="public-profile-avatar"
                />
              ) : null}
              <Heading>{p.profile.nickname}</Heading>
            </View>
          </Card>
          <Card>
            <Heading>Partidas</Heading>
            {hasStats(p.profile.stats) ? (
              <View testID="public-profile-stats">
                <Body>{statLine('paulista', p.profile.stats)}</Body>
                <Body>{statLine('mineiro', p.profile.stats)}</Body>
              </View>
            ) : (
              <Body muted testID="public-profile-stats-empty">
                Ainda sem partidas contadas.
              </Body>
            )}
          </Card>
          <Card>
            <Heading>Conquistas</Heading>
            {lines.length === 0 ? (
              <Body muted testID="public-profile-achievements-empty">
                Nenhuma conquista desbloqueada.
              </Body>
            ) : (
              lines.map((l) => (
                <Body key={l} testID="public-profile-achievement">
                  {l}
                </Body>
              ))
            )}
          </Card>
        </>
      ) : null}
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="public-profile-back" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
