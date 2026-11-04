import type { SocialProvider } from '@trucaco/protocol';
import { PROVIDER_BUTTON_LABEL } from '../net/identity';
import type { SocialMode } from '../lobby/socialAuth';
import { Button } from '../ui/Button';
import { Body, ErrorText, Notice } from '../ui/Typography';

export const LINK_INTRO_TEXT =
  'Vincule uma conta para não perder seu avatar, histórico e combinados se trocar de aparelho.';
export const LOGIN_WARNING_TEXT =
  'Entrar numa conta existente troca o convidado atual: o avatar e o histórico dele não vão junto.';
export const UNAVAILABLE_TEXT = 'indisponível';

export interface SocialAuthPanelProps {
  mode: SocialMode;
  providers: readonly { id: SocialProvider; available: boolean }[];
  /** Provedor em andamento (desabilita todos os botões). */
  busy: SocialProvider | null;
  error: string | null;
  /** `PROVIDER_TAKEN` ao vincular: oferece entrar na conta que já existe. */
  offerLogin: boolean;
  on: { press(id: SocialProvider): void; loginExisting(): void };
}

export function socialButtonLabel(mode: SocialMode, id: SocialProvider): string {
  const name = PROVIDER_BUTTON_LABEL[id];
  return mode === 'link' ? `Vincular com ${name}` : `Entrar com ${name}`;
}

/** Botões Google/Apple. Provedor sem SDK ou desligado no servidor aparece desabilitado e rotulado. */
export function SocialAuthPanel(p: SocialAuthPanelProps) {
  return (
    <>
      <Body muted testID={`social-${p.mode}-intro`}>
        {p.mode === 'link' ? LINK_INTRO_TEXT : LOGIN_WARNING_TEXT}
      </Body>
      {p.providers.map((pr) => (
        <Button
          key={pr.id}
          label={
            pr.available
              ? socialButtonLabel(p.mode, pr.id)
              : `${socialButtonLabel(p.mode, pr.id)} (${UNAVAILABLE_TEXT})`
          }
          variant="secondary"
          onPress={() => p.on.press(pr.id)}
          disabled={!pr.available || p.busy !== null}
          testID={`social-${p.mode}-${pr.id}`}
        />
      ))}
      {p.busy !== null ? (
        <Body muted testID="social-busy">
          Aguardando a conta…
        </Body>
      ) : null}
      {p.error !== null ? <ErrorText testID="social-error">{p.error}</ErrorText> : null}
      {p.offerLogin ? (
        <>
          <Notice testID="social-offer-login">{LOGIN_WARNING_TEXT}</Notice>
          <Button
            label="Entrar na conta existente"
            onPress={p.on.loginExisting}
            disabled={p.busy !== null}
            testID="social-login-existing"
          />
        </>
      ) : null}
    </>
  );
}
