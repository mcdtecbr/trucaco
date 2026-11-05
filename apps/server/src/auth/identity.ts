/**
 * Verificação de idToken de provedor social (Google e Apple), atrás de uma interface injetável.
 *
 * - `JwksIdentityVerifier` (produção): assinatura RS256 contra o JWKS do provedor (`jose`), `iss` fixo,
 *   `aud` dentro dos client IDs configurados, `exp`/`nbf` com tolerância curta e a claim `nonce` sempre
 *   igual ao nonce informado (cru, ou SHA-256 em hex na Apple).
 *   Nenhuma claim é aceita sem passar por isso. O provedor sem client ID configurado fica DESLIGADO.
 * - `TestIdentityVerifier` (só `NODE_ENV` development/test): `test:<sub>[:<qualquer coisa>]`. Não tem
 *   claim para o nonce, então não o confere; o `AuthService` continua exigindo e consumindo um nonce
 *   emitido por `GET /auth/nonce` (o fluxo do cliente é o mesmo de produção).
 *
 * O idToken e as claims nunca são logados. Só `sub` (e `email` verificado, que NÃO é persistido) saem
 * daqui.
 */
import { createHash } from 'node:crypto';
import { createRemoteJWKSet, errors, jwtVerify } from 'jose';
import { log } from '../logger';
import type { JWTVerifyGetKey } from 'jose';
import { SOCIAL_PROVIDERS } from '@trucaco/protocol';
import type { SocialProvider } from '@trucaco/protocol';
import { isDevLike } from './config';
import type { SocialConfig } from './config';

/** O idToken não vale (assinatura, `iss`, `aud`, `exp`, `nonce`, `sub` ou formato). Sem detalhe da causa. */
export class InvalidIdTokenError extends Error {
  constructor() {
    super('idToken inválido');
    this.name = 'InvalidIdTokenError';
  }
}

/** O JWKS do provedor está fora do ar (timeout, rede, resposta não 200). Vira 503, não 401. */
export class IdentityUnavailableError extends Error {
  constructor() {
    super('provedor de identidade indisponível');
    this.name = 'IdentityUnavailableError';
  }
}

/**
 * Falha de BUSCA das chaves (timeout, erro de rede, HTTP != 200), não do token: `JWKSTimeout`, erro que
 * não é do `jose` (ex.: `TypeError: fetch failed`) e o genérico do `jose` para resposta inesperada.
 * `JWKSNoMatchingKey` (kid desconhecido), assinatura, claims e formato continuam sendo token inválido.
 */
function isJwksUnavailable(err: unknown): boolean {
  if (err instanceof errors.JWKSTimeout) return true;
  if (err instanceof errors.JOSEError) return err.code === 'ERR_JOSE_GENERIC';
  return err instanceof Error;
}

export interface VerifiedIdentity {
  /** `sub` do provedor: identificador estável da conta (1 a 255 caracteres). */
  readonly subject: string;
  /** Só presente se o provedor marcou `email_verified`. Não é persistido (sem PII no banco). */
  readonly email?: string;
  /** Epoch em segundos em que o token expira (define o TTL do uso único). */
  readonly expiresAt: number;
}

export interface IdentityVerifier {
  /** O provedor tem client ID configurado? Falso = `SOCIAL_LOGIN_DISABLED`. */
  isEnabled(provider: SocialProvider): boolean;
  /**
   * Lança `InvalidIdTokenError` para qualquer falha de validação. `nonce` é o que o cliente diz ter enviado
   * ao provedor: a claim `nonce` do token tem de bater (se foi emitido por nós é conferido pelo `AuthService`).
   */
  verify(provider: SocialProvider, idToken: string, nonce: string): Promise<VerifiedIdentity>;
}

export const enabledProviders = (v: IdentityVerifier): SocialProvider[] =>
  SOCIAL_PROVIDERS.filter((p) => v.isEnabled(p));

/** Verificador que desliga tudo (servidor sem credenciais). */
export const DISABLED_IDENTITY: IdentityVerifier = {
  isEnabled: () => false,
  verify: () => Promise.reject(new InvalidIdTokenError()),
};

interface ProviderSpec {
  readonly jwksUrl: string;
  readonly issuers: readonly string[];
}

const SPECS: Readonly<Record<SocialProvider, ProviderSpec>> = {
  google: {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
  },
  apple: {
    jwksUrl: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
  },
};

export interface JwksIdentityOptions {
  /** Client IDs aceitos em `aud`, por provedor. Lista vazia = provedor desligado. */
  readonly clientIds: Readonly<Record<SocialProvider, readonly string[]>>;
  /** Resolvedor de chaves por provedor (testes injetam um JWKS local). Padrão: JWKS remoto com cache. */
  readonly keys?: Partial<Record<SocialProvider, JWTVerifyGetKey>>;
  /** Tolerância de relógio, em segundos. */
  readonly clockToleranceSec?: number;
}

const SUBJECT_MAX = 255;
const sha256Hex = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** `email_verified` chega como boolean (Google) ou como a string `"true"` (Apple, às vezes o Google). */
const isTrue = (v: unknown): boolean => v === true || v === 'true';

export class JwksIdentityVerifier implements IdentityVerifier {
  private readonly keys = new Map<SocialProvider, JWTVerifyGetKey>();

  constructor(private readonly opts: JwksIdentityOptions) {
    for (const provider of SOCIAL_PROVIDERS) {
      this.keys.set(
        provider,
        opts.keys?.[provider] ??
          createRemoteJWKSet(new URL(SPECS[provider].jwksUrl), {
            timeoutDuration: 5000,
            cooldownDuration: 30_000,
            cacheMaxAge: 3_600_000,
          }),
      );
    }
  }

  isEnabled(provider: SocialProvider): boolean {
    return this.opts.clientIds[provider].length > 0;
  }

  async verify(
    provider: SocialProvider,
    idToken: string,
    nonce: string,
  ): Promise<VerifiedIdentity> {
    const audience = this.opts.clientIds[provider];
    const getKey = this.keys.get(provider);
    if (audience.length === 0 || getKey === undefined) throw new InvalidIdTokenError();
    let payload: Awaited<ReturnType<typeof jwtVerify>>['payload'];
    try {
      ({ payload } = await jwtVerify(idToken, getKey, {
        algorithms: ['RS256'],
        issuer: [...SPECS[provider].issuers],
        audience: [...audience],
        clockTolerance: this.opts.clockToleranceSec ?? 5,
        requiredClaims: ['sub', 'exp', 'iss', 'aud'],
      }));
    } catch (err) {
      // Só o NOME do erro vai ao log (nunca o token nem a mensagem, que pode ecoar claims).
      const name = err instanceof Error ? err.name : 'unknown';
      if (isJwksUnavailable(err)) {
        log.warn('identity: JWKS indisponível', { provider, error: name });
        throw new IdentityUnavailableError();
      }
      // Assinatura, iss, aud, exp, formato e chave desconhecida: o cliente não vê a causa.
      log.warn('identity: idToken recusado', { provider, error: name });
      throw new InvalidIdTokenError();
    }
    const { sub, exp } = payload;
    if (typeof sub !== 'string' || sub.length < 1 || sub.length > SUBJECT_MAX) {
      throw new InvalidIdTokenError();
    }
    if (typeof exp !== 'number') throw new InvalidIdTokenError();
    // Sempre exigido. Google: o nonce vai cru na claim. Apple: o app costuma mandar o SHA-256 do nonce ao
    // provedor e o cru ao servidor. As duas formas só se obtêm sabendo o nonce.
    const claim = payload['nonce'];
    if (
      nonce === '' ||
      typeof claim !== 'string' ||
      (claim !== nonce && claim !== sha256Hex(nonce))
    ) {
      throw new InvalidIdTokenError();
    }
    const email = payload['email'];
    return {
      subject: sub,
      expiresAt: exp,
      ...(typeof email === 'string' && email !== '' && isTrue(payload['email_verified'])
        ? { email }
        : {}),
    };
  }
}

/**
 * Escolhe o verificador pelo ambiente: teste (`AUTH_TEST_IDENTITY=1`, só dev/test), JWKS (client IDs
 * configurados) ou desligado. Sem credenciais o login social responde `SOCIAL_LOGIN_DISABLED`.
 */
export function buildIdentityVerifier(cfg: SocialConfig): IdentityVerifier {
  if (cfg.testIdentity) return new TestIdentityVerifier(process.env.NODE_ENV);
  if (cfg.googleClientIds.length === 0 && cfg.appleClientIds.length === 0) return DISABLED_IDENTITY;
  return new JwksIdentityVerifier({
    clientIds: { google: cfg.googleClientIds, apple: cfg.appleClientIds },
  });
}

const TEST_TOKEN = /^test:([A-Za-z0-9_-]{1,64})(?::[A-Za-z0-9_-]{0,64})?$/;

/**
 * Verificador de desenvolvimento e testes: `test:<sub>` ou `test:<sub>:<sufixo>` (o sufixo só torna o
 * token único, já que o uso único vale por token). Recusa-se a existir fora de development/test.
 */
export class TestIdentityVerifier implements IdentityVerifier {
  constructor(
    nodeEnv: string | undefined,
    private readonly now: () => number = Date.now,
  ) {
    if (!isDevLike(nodeEnv)) {
      throw new Error('TestIdentityVerifier só existe em development/test.');
    }
  }

  isEnabled(): boolean {
    return true;
  }

  async verify(_provider: SocialProvider, idToken: string): Promise<VerifiedIdentity> {
    const m = TEST_TOKEN.exec(idToken);
    if (m?.[1] === undefined) throw new InvalidIdTokenError();
    return { subject: m[1], expiresAt: Math.floor(this.now() / 1000) + 3600 };
  }
}
