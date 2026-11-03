import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { TextField } from '../ui/TextField';
import { Body, Card, ErrorText, Heading, Title } from '../ui/Typography';

export interface SettingsViewProps {
  nickname: string | null;
  draft: string;
  busy: boolean;
  error: string | null;
  saved: boolean;
  appVersion: string;
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
      <Card>
        <Heading>Sessão</Heading>
        <Body muted>
          Você joga como convidado. Sair apaga esta sessão neste aparelho e cria um novo convidado.
        </Body>
        <Button
          label="Sair"
          variant="secondary"
          onPress={p.on.logout}
          disabled={p.busy}
          testID="logout"
        />
      </Card>
      <Body muted testID="versions">{`App ${p.appVersion} · protocolo v${PROTOCOL_VERSION}`}</Body>
      <Button label="Voltar" variant="secondary" onPress={p.on.back} testID="settings-back" />
    </Screen>
  );
}
