import { Button } from '../ui/Button';
import { Screen } from '../ui/Screen';
import { Body, Card, Heading, Title } from '../ui/Typography';
import { SocialAuthPanel } from './SocialAuthPanel';
import type { SocialAuthPanelProps } from './SocialAuthPanel';

export interface LoginViewProps {
  /** Apelido do convidado atual (o que se perde ao entrar em outra conta). */
  nickname: string | null;
  social: SocialAuthPanelProps;
  on: { guest(): void };
}

/** Entrada com conta Google/Apple, ou seguir como convidado. */
export function LoginView(p: LoginViewProps) {
  return (
    <Screen testID="login">
      <Title>Trucaço</Title>
      <Card>
        <Heading>Entrar com uma conta</Heading>
        <SocialAuthPanel {...p.social} />
      </Card>
      <Card>
        <Heading>Continuar como convidado</Heading>
        <Body muted>
          {p.nickname !== null
            ? `Você segue jogando como ${p.nickname}. Dá para vincular uma conta depois, em Configurações.`
            : 'Dá para vincular uma conta depois, em Configurações.'}
        </Body>
        <Button label="Continuar como convidado" onPress={p.on.guest} testID="login-guest" />
      </Card>
    </Screen>
  );
}
