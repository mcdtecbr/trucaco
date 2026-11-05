import { PROTOCOL_VERSION } from '@trucaco/protocol';
import type { AuthProvider, BlockedUser } from '@trucaco/protocol';
import type { AudioPrefs } from '../audio/prefs';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@trucaco/ui';
import { Body, Card, ErrorText, Heading, Notice, Title } from '../ui/Typography';
import { PROVIDER_LABEL } from '../profile/history';
import { LegalLinks } from './LegalLinks';
import type { LegalLinksProps } from './LegalLinks';
import { SocialAuthPanel } from './SocialAuthPanel';
import type { SocialAuthPanelProps } from './SocialAuthPanel';
import { SoundSettings } from './SoundSettings';

export const DELETE_WARNING_TEXT =
  'Apagar a conta é definitivo. Seu avatar, suas conquistas, missões e estatísticas, os combinados de sinais e todas as sessões deste e de outros aparelhos serão apagados. As partidas que você jogou continuam para os outros jogadores, mas o seu nome some delas. Não dá para desfazer.';
export const DELETE_CONFIRM_TEXT =
  'Última confirmação: sua conta será apagada agora e você voltará ao início como um novo convidado.';
export const BLOCKS_EMPTY_TEXT = 'Você não bloqueou ninguém.';

/** Conta: tipo, bloqueados e apagar conta. Omitido = só o cartão de sessão simples. */
export interface AccountSectionProps {
  provider: AuthProvider | null;
  blocks: {
    state: 'loading' | 'ready' | 'error';
    items: readonly BlockedUser[];
    error: string | null;
    /** Id em desbloqueio (desabilita o botão dele). */
    busyId: string | null;
  };
  deletion: { step: 0 | 1 | 2; busy: boolean; error: string | null };
  /** Vincular conta (só aparece para convidado). */
  social?: SocialAuthPanelProps;
  on: {
    achievements?(): void;
    missions?(): void;
    /** Tela de entrada com conta existente (convidado). */
    login?(): void;
    profile(): void;
    unblock(userId: string): void;
    retryBlocks(): void;
    deleteStart(): void;
    deleteContinue(): void;
    deleteCancel(): void;
    deleteConfirm(): void;
  };
}

export interface SettingsViewProps {
  nickname: string | null;
  draft: string;
  busy: boolean;
  error: string | null;
  saved: boolean;
  appVersion: string;
  /** Preferências de som deste aparelho. Omitido = sem o cartão de som. */
  sound?: { prefs: AudioPrefs; onChange(patch: Partial<AudioPrefs>): void };
  account?: AccountSectionProps;
  /** Atalhos para Termos e Privacidade. */
  legal?: LegalLinksProps;
  on: {
    draft(text: string): void;
    save(): void;
    logout(): void;
    back(): void;
    avatar(): void;
  };
}

export function SettingsView(p: SettingsViewProps) {
  return (
    <Screen testID="settings">
      <Title>Configurações</Title>
      <Card>
        <Heading>Apelido</Heading>
        <Body muted>{p.nickname !== null ? `Atual: ${p.nickname}` : ' '}</Body>
        <TextField
          label="Novo apelido"
          value={p.draft}
          onChangeText={p.on.draft}
          maxLength={16}
          disabled={p.busy}
          onSubmit={p.on.save}
          testID="nickname-input"
        />
        {p.error !== null ? <ErrorText testID="nickname-error">{p.error}</ErrorText> : null}
        {p.saved ? <Body testID="nickname-saved">Apelido atualizado.</Body> : null}
        <Button
          label={p.busy ? 'Salvando…' : 'Salvar apelido'}
          onPress={p.on.save}
          disabled={p.busy}
          testID="nickname-save"
        />
      </Card>
      <Card>
        <Heading>Avatar</Heading>
        <Body muted>Escolha o rosto, o cabelo e a roupa que aparecem para a mesa.</Body>
        <Button
          label="Editar avatar"
          variant="secondary"
          onPress={p.on.avatar}
          disabled={p.busy}
          testID="settings-avatar"
        />
      </Card>
      {p.sound !== undefined ? (
        <SoundSettings prefs={p.sound.prefs} onChange={p.sound.onChange} />
      ) : null}
      {p.account !== undefined ? (
        <Button
          label="Meu perfil e histórico"
          variant="secondary"
          onPress={p.account.on.profile}
          disabled={p.busy}
          testID="settings-profile"
        />
      ) : null}
      {p.account?.on.achievements !== undefined ? (
        <Button
          label="Conquistas"
          variant="secondary"
          onPress={p.account.on.achievements}
          disabled={p.busy}
          testID="settings-achievements"
        />
      ) : null}
      {p.account?.on.missions !== undefined ? (
        <Button
          label="Missões"
          variant="secondary"
          onPress={p.account.on.missions}
          disabled={p.busy}
          testID="settings-missions"
        />
      ) : null}
      {p.account?.provider === 'guest' && p.account.social !== undefined ? (
        <Card>
          <Heading>Vincular conta</Heading>
          <SocialAuthPanel {...p.account.social} />
          {p.account.on.login !== undefined ? (
            <Button
              label="Já tenho uma conta"
              variant="secondary"
              onPress={p.account.on.login}
              disabled={p.busy}
              testID="settings-login"
            />
          ) : null}
        </Card>
      ) : null}
      {p.account !== undefined ? <BlockedSection account={p.account} busy={p.busy} /> : null}
      <Card>
        <Heading>Sessão</Heading>
        <Body muted testID="session-note">
          {sessionNote(p.account?.provider ?? null)}
        </Body>
        <Button
          label="Sair"
          variant="secondary"
          onPress={p.on.logout}
          disabled={p.busy}
          testID="logout"
        />
      </Card>
      {p.account !== undefined ? <DeleteSection account={p.account} busy={p.busy} /> : null}
      {p.legal !== undefined ? (
        <Card>
          <Heading>Termos e privacidade</Heading>
          <LegalLinks {...p.legal} />
        </Card>
      ) : null}
      <Body muted testID="versions">{`App ${p.appVersion} · protocolo v${PROTOCOL_VERSION}`}</Body>
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="settings-back" />
    </Screen>
  );
}

function sessionNote(provider: AuthProvider | null): string {
  if (provider === 'google' || provider === 'apple') {
    return `Você entrou com ${PROVIDER_LABEL[provider]}. Sair encerra a sessão neste aparelho.`;
  }
  return 'Você joga como convidado. Sair apaga esta sessão neste aparelho e cria um novo convidado.';
}

function BlockedSection({ account, busy }: { account: AccountSectionProps; busy: boolean }) {
  const { blocks } = account;
  return (
    <Card>
      <Heading>Jogadores bloqueados</Heading>
      {blocks.state === 'loading' ? <Body muted>Carregando…</Body> : null}
      {blocks.state === 'error' ? (
        <>
          <ErrorText testID="blocks-error">{blocks.error ?? ''}</ErrorText>
          <Button
            label="Tentar de novo"
            variant="secondary"
            onPress={account.on.retryBlocks}
            testID="blocks-retry"
          />
        </>
      ) : null}
      {blocks.state === 'ready' && blocks.items.length === 0 ? (
        <Body muted testID="blocks-empty">
          {BLOCKS_EMPTY_TEXT}
        </Body>
      ) : null}
      {blocks.state === 'ready' && blocks.error !== null ? (
        <ErrorText testID="blocks-action-error">{blocks.error}</ErrorText>
      ) : null}
      {blocks.items.map((b) => {
        const name = b.nickname ?? 'Jogador removido';
        return (
          <View key={b.userId} style={styles.blockRow}>
            <Body>{name}</Body>
            <Button
              label={`Desbloquear ${name}`}
              variant="secondary"
              onPress={() => account.on.unblock(b.userId)}
              disabled={busy || blocks.busyId === b.userId}
              testID={`unblock-${b.userId}`}
            />
          </View>
        );
      })}
    </Card>
  );
}

function DeleteSection({ account, busy }: { account: AccountSectionProps; busy: boolean }) {
  const { deletion, on } = account;
  return (
    <Card>
      <Heading>Apagar conta</Heading>
      {deletion.step === 0 ? (
        <>
          <Body muted>Remove sua conta e os dados dela deste servidor.</Body>
          <Button
            label="Apagar conta"
            variant="secondary"
            onPress={on.deleteStart}
            disabled={busy}
            testID="delete-start"
          />
        </>
      ) : null}
      {deletion.step === 1 ? (
        <>
          <Notice testID="delete-warning">{DELETE_WARNING_TEXT}</Notice>
          <Button label="Continuar" onPress={on.deleteContinue} testID="delete-continue" />
          <Button
            label="Cancelar"
            variant="secondary"
            onPress={on.deleteCancel}
            testID="delete-cancel"
          />
        </>
      ) : null}
      {deletion.step === 2 ? (
        <>
          <Notice testID="delete-final">{DELETE_CONFIRM_TEXT}</Notice>
          {deletion.error !== null ? (
            <ErrorText testID="delete-error">{deletion.error}</ErrorText>
          ) : null}
          <Button
            label={deletion.busy ? 'Apagando…' : 'Apagar minha conta para sempre'}
            onPress={on.deleteConfirm}
            disabled={deletion.busy}
            testID="delete-confirm"
          />
          <Button
            label="Cancelar"
            variant="secondary"
            onPress={on.deleteCancel}
            disabled={deletion.busy}
            testID="delete-cancel"
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  blockRow: { gap: spacing.xs },
});
