/**
 * Ponto de extensão do login social (Fase 6, bloco 6G). O cliente só sabe pedir um idToken a um
 * `IdentityProvider`; quem fala com o Google ou a Apple (SDK, navegador, nonce) fica atrás dessa interface.
 *
 * Nenhum SDK real está ligado ainda (credenciais são do usuário; nativo fica para a Fase 7): o registro
 * nasce VAZIO e o provedor aparece como "indisponível neste aparelho". Para ligar um provedor, chame
 * `registerIdentityProvider` na composição do app (ex.: Google web com `expo-auth-session`). O idToken
 * nunca é logado nem guardado: vai direto ao `session.loginSocial` / `linkAccount`.
 */
import { SOCIAL_PROVIDERS } from '@trucaco/protocol';
import type { SocialProvider } from '@trucaco/protocol';

export interface IdentityCredential {
  readonly idToken: string;
}

export interface IdentityProvider {
  readonly provider: SocialProvider;
  /**
   * Abre o fluxo do provedor. `nonce` é o de `GET /auth/nonce` (uso único): o SDK o passa ao provedor, para
   * ele entrar na claim `nonce` do idToken, e o cliente o reenvia ao servidor. `null` = o usuário fechou ou
   * cancelou. Erro de SDK deve ser lançado.
   */
  getCredential(nonce: string): Promise<IdentityCredential | null>;
}

export const PROVIDER_BUTTON_LABEL: Readonly<Record<SocialProvider, string>> = {
  google: 'Google',
  apple: 'Apple',
};

export interface IdentityRegistry {
  register(provider: IdentityProvider): void;
  get(provider: SocialProvider): IdentityProvider | null;
  /** Provedores com SDK ligado neste aparelho, na ordem do protocolo. */
  available(): readonly SocialProvider[];
}

export function createIdentityRegistry(): IdentityRegistry {
  const map = new Map<SocialProvider, IdentityProvider>();
  return {
    register: (p) => void map.set(p.provider, p),
    get: (id) => map.get(id) ?? null,
    available: () => SOCIAL_PROVIDERS.filter((id) => map.has(id)),
  };
}

/** Registro do app. Vazio até a Fase 7 (ou até alguém ligar um SDK). */
export const identityRegistry: IdentityRegistry = createIdentityRegistry();
