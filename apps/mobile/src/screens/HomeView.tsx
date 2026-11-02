import type { VariantId } from '@trucaco/protocol';
import { StyleSheet, View } from 'react-native';
import { withRetry } from '../i18n/errors';
import { formatCodeDisplay } from '../lobby/codeInput';
import type { LobbyBusy, LobbyError, LobbyScope, QueueView } from '../store/lobbyStore';
import { spacing } from '../theme';
import { Button } from '../ui/Button';
import { ChoiceGroup, Toggle } from '../ui/Choice';
import { Screen } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { Body, Card, ErrorText, Heading, Notice, Title } from '../ui/Typography';

export const VARIANT_OPTIONS = [
  { value: 'paulista', label: 'Paulista' },
  { value: 'mineiro', label: 'Mineiro' },
] as const satisfies readonly { value: VariantId; label: string }[];

export const FORMAT_OPTIONS = [
  { value: 'single', label: 'Partida única' },
  { value: 'bo3', label: 'Melhor de 3' },
] as const;

export interface TableForm {
  variant: VariantId;
  format: 'single' | 'bo3';
  ironHand: boolean;
}
export interface QueueForm {
  variant: VariantId;
  ironHand: boolean;
}

export interface HomeViewProps {
  nickname: string | null;
  lostSession: boolean;
  queueExpired: boolean;
  table: TableForm;
  code: string;
  queueForm: QueueForm;
  queue: QueueView;
  remainingSeconds: number;
  busy: LobbyBusy;
  error: LobbyError | null;
  /** Segundos de `Retry-After` que faltam para o erro atual (0 = livre). */
  retryRemaining: number;
  on: {
    dismissLost(): void;
    table(next: TableForm): void;
    create(): void;
    code(text: string): void;
    join(): void;
    queueForm(next: QueueForm): void;
    queueStart(): void;
    queueCancel(): void;
    settings(): void;
  };
}

function errorFor(error: LobbyError | null, scope: LobbyScope, retryRemaining: number) {
  if (error === null || error.scope !== scope) return null;
  return (
    <ErrorText testID={`error-${scope}`}>
      {withRetry(error.code, error.retryUntil !== undefined ? retryRemaining : undefined)}
    </ErrorText>
  );
}

/** Tela inicial: só apresentação. Estado e rede ficam no container (`HomeScreen`). */
export function HomeView(p: HomeViewProps) {
  const inQueue = p.queue.status === 'queued' || p.queue.status === 'matched';
  const locked = p.busy !== 'none' || inQueue;
  const waiting = (scope: LobbyScope): boolean => p.error?.scope === scope && p.retryRemaining > 0;
  return (
    <Screen testID="home">
      <View style={styles.header}>
        <Title>Trucaco</Title>
        {p.nickname !== null ? <Body muted>{`Jogando como ${p.nickname}`}</Body> : null}
      </View>

      {p.lostSession ? (
        <View>
          <Notice testID="notice-lost-session">
            Sessão anterior perdida, criamos um novo convidado.
          </Notice>
          <Button label="Entendi" variant="secondary" onPress={p.on.dismissLost} />
        </View>
      ) : null}

      <Card>
        <Heading>Criar mesa privada</Heading>
        <ChoiceGroup
          label="Variante"
          options={VARIANT_OPTIONS}
          value={p.table.variant}
          onChange={(variant) => p.on.table({ ...p.table, variant })}
          disabled={locked}
          testID="create-variant"
        />
        <ChoiceGroup
          label="Formato"
          options={FORMAT_OPTIONS}
          value={p.table.format}
          onChange={(format) => p.on.table({ ...p.table, format })}
          disabled={locked}
          testID="create-format"
        />
        <Toggle
          label="Mão de ferro"
          value={p.table.ironHand}
          onChange={(ironHand) => p.on.table({ ...p.table, ironHand })}
          disabled={locked}
          testID="create-iron"
        />
        {errorFor(p.error, 'create', p.retryRemaining)}
        <Button
          label={p.busy === 'create' ? 'Criando…' : 'Criar mesa'}
          onPress={p.on.create}
          disabled={locked || waiting('create')}
          testID="create-submit"
        />
      </Card>

      <Card>
        <Heading>Entrar com código</Heading>
        <TextField
          label="Código da mesa"
          value={formatCodeDisplay(p.code)}
          onChangeText={p.on.code}
          placeholder="ABCD-EFGH"
          autoCapitalize="characters"
          maxLength={9}
          disabled={locked}
          onSubmit={p.on.join}
          testID="join-code"
        />
        {errorFor(p.error, 'join', p.retryRemaining)}
        <Button
          label={p.busy === 'join' ? 'Entrando…' : 'Entrar na mesa'}
          onPress={p.on.join}
          disabled={locked || waiting('join')}
          testID="join-submit"
        />
      </Card>

      <Card>
        <Heading>Fila pública</Heading>
        {p.queueExpired ? (
          <Notice testID="notice-queue-expired">
            A busca expirou sem formar mesa. Você pode tentar de novo.
          </Notice>
        ) : null}
        <ChoiceGroup
          label="Variante"
          options={VARIANT_OPTIONS}
          value={p.queueForm.variant}
          onChange={(variant) => p.on.queueForm({ ...p.queueForm, variant })}
          disabled={locked}
          testID="queue-variant"
        />
        <Toggle
          label="Mão de ferro"
          value={p.queueForm.ironHand}
          onChange={(ironHand) => p.on.queueForm({ ...p.queueForm, ironHand })}
          disabled={locked}
          testID="queue-iron"
        />
        {errorFor(p.error, 'queue', p.retryRemaining)}
        <QueueStatus queue={p.queue} remainingSeconds={p.remainingSeconds} />
        {p.queue.status === 'queued' ? (
          <Button
            label="Sair da fila"
            variant="secondary"
            onPress={p.on.queueCancel}
            disabled={p.busy !== 'none'}
            testID="queue-cancel"
          />
        ) : (
          <Button
            label={p.busy === 'queue' ? 'Entrando na fila…' : 'Entrar na fila'}
            onPress={p.on.queueStart}
            disabled={locked || waiting('queue')}
            testID="queue-start"
          />
        )}
      </Card>

      <Button
        label="Configurações"
        variant="secondary"
        onPress={p.on.settings}
        disabled={locked}
        testID="open-settings"
      />
    </Screen>
  );
}

export function QueueStatus({
  queue,
  remainingSeconds,
}: {
  queue: QueueView;
  remainingSeconds: number;
}) {
  switch (queue.status) {
    case 'queued':
      return (
        <Body testID="queue-status">
          {`Procurando jogadores… a busca expira em ${remainingSeconds} s`}
        </Body>
      );
    case 'matched':
      return <Body testID="queue-status">Mesa encontrada! Sentando…</Body>;
    case 'seated':
      return (
        <Body testID="queue-status">
          Você já está sentado em uma mesa (em outra aba ou aparelho).
        </Body>
      );
    default:
      return null;
  }
}

const styles = StyleSheet.create({
  header: { gap: spacing.xs, paddingTop: spacing.md },
});
