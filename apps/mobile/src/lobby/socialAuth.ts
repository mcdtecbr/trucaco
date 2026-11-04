/**
 * Fluxo de entrar/vincular com Google ou Apple (puro: sem React). O idToken vem de um
 * `IdentityProvider` e vai direto para a sessão; nada é logado nem guardado aqui.
 */
import { SOCIAL_PROVIDERS, isSocialProvider } from '@trucaco/protocol';
import type { SocialProvider } from '@trucaco/protocol';
import { errorCodeOf, errorMessage } from '../i18n/errors';
import type { IdentityRegistry } from '../net/identity';
import type { Session } from '../net/session';

export type SocialMode = 'login' | 'link';

export type SocialOutcome =
  | { kind: 'done' }
  /** O usuário fechou o fluxo do provedor: nada a mostrar. */
  | { kind: 'cancelled' }
  /** Sem SDK neste aparelho ou servidor com o provedor desligado (`SOCIAL_LOGIN_DISABLED`). */
  | { kind: 'unavailable'; message: string }
  | {
      kind: 'error';
      code: string;
      message: string;
      /** `PROVIDER_TAKEN` ao vincular: oferecer "entrar na conta existente". */
      offerLogin: boolean;
    };

export const NO_SDK_TEXT = 'Entrar com essa conta ainda não está disponível neste aparelho.';

export async function runSocialAuth(args: {
  mode: SocialMode;
  provider: SocialProvider;
  registry: IdentityRegistry;
  session: Pick<Session, 'loginSocial' | 'linkAccount'>;
}): Promise<SocialOutcome> {
  const identity = args.registry.get(args.provider);
  if (identity === null) return { kind: 'unavailable', message: NO_SDK_TEXT };
  let credential;
  try {
    credential = await identity.getCredential();
  } catch {
    return { kind: 'error', code: 'UNKNOWN', message: errorMessage('UNKNOWN'), offerLogin: false };
  }
  if (credential === null) return { kind: 'cancelled' };
  const req = {
    provider: args.provider,
    idToken: credential.idToken,
    ...(credential.nonce !== undefined ? { nonce: credential.nonce } : {}),
  };
  try {
    if (args.mode === 'link') await args.session.linkAccount(req);
    else await args.session.loginSocial(req);
    return { kind: 'done' };
  } catch (e) {
    const code = errorCodeOf(e);
    if (code === 'SOCIAL_LOGIN_DISABLED') {
      return { kind: 'unavailable', message: errorMessage(code) };
    }
    return {
      kind: 'error',
      code,
      message: errorMessage(code),
      offerLogin: args.mode === 'link' && code === 'PROVIDER_TAKEN',
    };
  }
}

/** Provedores que o servidor diz ter ligados (`/health`); `null` se não informou (servidor antigo, falha). */
export function serverProvidersOf(health: unknown): readonly SocialProvider[] | null {
  if (typeof health !== 'object' || health === null) return null;
  const list = (health as { socialProviders?: unknown }).socialProviders;
  return Array.isArray(list) ? list.filter(isSocialProvider) : null;
}

/**
 * Botão ativo só se HÁ SDK registrado E o servidor liga o provedor. Sem resposta do `/health`
 * (`server === null`) vale só o SDK: o servidor ainda responde `SOCIAL_LOGIN_DISABLED` se for o caso.
 */
export function providerStates(
  registry: IdentityRegistry,
  server: readonly SocialProvider[] | null,
  disabled: readonly SocialProvider[],
): { id: SocialProvider; available: boolean }[] {
  return SOCIAL_PROVIDERS.map((id) => ({
    id,
    available:
      registry.get(id) !== null &&
      (server === null || server.includes(id)) &&
      !disabled.includes(id),
  }));
}
