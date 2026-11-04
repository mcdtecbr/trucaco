/**
 * Casos de uso de autenticação: criar convidado, rotacionar refresh e autenticar access token.
 * Sem HTTP aqui. Refresh token: 32 bytes aleatórios em base64url (opaco); só o SHA-256 vai ao store.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import type { SocialProvider } from '@trucaco/protocol';
import { log } from '../logger';
import {
  NicknameTakenError,
  ProviderSubjectTakenError,
  type UserRecord,
  type UserRepository,
} from '../db/types';
import type { AuthConfig } from './config';
import {
  DISABLED_IDENTITY,
  IdentityUnavailableError,
  InvalidIdTokenError,
  enabledProviders,
  type IdentityVerifier,
  type VerifiedIdentity,
} from './identity';
import { AccessTokenService, InvalidTokenError } from './jwt';
import type { TokenStore } from './tokenStore';

export const AUTH_ERROR_CODES = [
  'UNAUTHORIZED',
  'INVALID_REFRESH_TOKEN',
  'SERVICE_UNAVAILABLE',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
  }
}

export const SOCIAL_ERROR_CODES = [
  'ALREADY_LINKED',
  'INVALID_ID_TOKEN',
  'PROVIDER_TAKEN',
  'SOCIAL_LOGIN_DISABLED',
] as const;
export type SocialErrorCode = (typeof SOCIAL_ERROR_CODES)[number];

/** Falhas de login social e vínculo (a rota as traduz em HTTP). Nunca carrega o token nem a causa. */
export class SocialAuthError extends Error {
  constructor(readonly code: SocialErrorCode) {
    super(code);
    this.name = 'SocialAuthError';
  }
}

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Validade do access, em segundos. */
  readonly expiresIn: number;
}

export interface Principal {
  readonly userId: string;
  readonly jti: string;
}

/** Formato do refresh emitido por nós (32 bytes em base64url). Outra coisa nem vai ao store. */
const REFRESH_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const GUEST_ATTEMPTS = 5;
const REVOKE_RETRIES = 3;

export const hashRefresh = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const newRefresh = (): string => randomBytes(32).toString('base64url');

export class AuthService {
  readonly jwt: AccessTokenService;

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenStore,
    private readonly cfg: AuthConfig,
    private readonly now: () => number = Date.now,
    private readonly identity: IdentityVerifier = DISABLED_IDENTITY,
    /** Espera base (ms) do reagendamento da revogação pós-vínculo. */
    private readonly revokeRetryMs: number = 5000,
  ) {
    this.jwt = new AccessTokenService(cfg, now);
  }

  /** Provedores de login social ligados (`GET /health`). */
  socialProviders(): SocialProvider[] {
    return enabledProviders(this.identity);
  }

  /** Abre uma família de refresh nova para o usuário e emite o par de tokens. */
  private async issuePair(userId: string): Promise<TokenPair> {
    return (await this.issueFamily(userId)).pair;
  }

  private async issueFamily(
    userId: string,
  ): Promise<{ readonly pair: TokenPair; readonly familyId: string }> {
    const refreshToken = newRefresh();
    const access = await this.jwt.sign(userId);
    const familyId = randomUUID();
    await this.tokens.createFamily({
      familyId,
      userId,
      refreshHash: hashRefresh(refreshToken),
      jti: access.jti,
      ttlSec: Math.min(this.cfg.refreshTtlSec, this.cfg.refreshFamilyMaxSec),
    });
    return {
      pair: { accessToken: access.token, refreshToken, expiresIn: this.cfg.accessTtlSec },
      familyId,
    };
  }

  /**
   * Valida o idToken no provedor e o consome (uso único: `SET NX EX` pelo hash do token). Provedor sem
   * client ID: `SOCIAL_LOGIN_DISABLED`. Qualquer falha de validação ou reuso: `INVALID_ID_TOKEN`, sem
   * distinguir a causa. Claims só são lidas pelo verificador depois de assinatura, `iss`, `aud`, `exp`
   * e `nonce` conferidos.
   */
  private async verifyIdToken(
    provider: SocialProvider,
    idToken: string,
    nonce: string | undefined,
    claim: boolean,
  ): Promise<VerifiedIdentity> {
    if (!this.identity.isEnabled(provider)) throw new SocialAuthError('SOCIAL_LOGIN_DISABLED');
    let verified: VerifiedIdentity;
    try {
      verified = await this.identity.verify(provider, idToken, nonce);
    } catch (err) {
      if (err instanceof InvalidIdTokenError) {
        log.warn('auth: idToken social recusado', { provider });
        throw new SocialAuthError('INVALID_ID_TOKEN');
      }
      // JWKS fora do ar: 503 (o token não é culpado e não foi gasto).
      if (err instanceof IdentityUnavailableError) throw new AuthError('SERVICE_UNAVAILABLE');
      throw err;
    }
    if (claim) await this.claimIdToken(provider, idToken, verified);
    return verified;
  }

  private async claimIdToken(
    provider: SocialProvider,
    idToken: string,
    verified: VerifiedIdentity,
  ): Promise<void> {
    const ttlSec = Math.max(
      60,
      Math.ceil(verified.expiresAt - this.now() / 1000) + this.cfg.clockToleranceSec + 1,
    );
    const key = createHash('sha256').update(`${provider}:${idToken}`, 'utf8').digest('hex');
    if (!(await this.tokens.claimIdToken(key, ttlSec))) {
      log.warn('auth: idToken social reapresentado', { provider });
      throw new SocialAuthError('INVALID_ID_TOKEN');
    }
  }

  /**
   * Login social (`POST /auth/google|apple`). Conta com o `sub` existe: entra nela. Não existe: nasce uma
   * conta social nova, com apelido gerado (o apelido e o e-mail do provedor nunca são usados). A resposta
   * não diz mais que `created` a quem já provou ser dono do token: não há oráculo para terceiros.
   */
  async loginSocial(
    provider: SocialProvider,
    idToken: string,
    nonce?: string,
  ): Promise<{ readonly user: UserRecord; readonly pair: TokenPair; readonly created: boolean }> {
    const identity = await this.verifyIdToken(provider, idToken, nonce, true);
    let user = await this.users.findByProvider(provider, identity.subject);
    let created = false;
    for (let i = 0; i < GUEST_ATTEMPTS && user === null; i++) {
      try {
        user = await this.users.createSocialUser({
          provider,
          providerSubject: identity.subject,
          nickname: `Jogador${randomInt(1000, 10_000_000)}`,
        });
        created = true;
      } catch (err) {
        if (err instanceof ProviderSubjectTakenError) {
          // Corrida: outro pedido criou a conta no mesmo instante. Entra nela.
          user = await this.users.findByProvider(provider, identity.subject);
        } else if (!(err instanceof NicknameTakenError)) {
          throw err;
        }
      }
    }
    if (user === null) throw new AuthError('SERVICE_UNAVAILABLE');
    log.info('auth: login social', { provider, created });
    return { user, pair: await this.issuePair(user.id), created };
  }

  /**
   * Vínculo do convidado autenticado a um provedor (`POST /auth/link`). O `userId` vem do token, nunca do
   * corpo. O `id` é mantido (histórico, progressão, avatar e combinados seguem). Falhas: já vinculado
   * (`ALREADY_LINKED`), `sub` de outra conta (`PROVIDER_TAKEN`, checado ANTES de consumir o idToken para o
   * cliente poder usá-lo em `loginSocial`). O vínculo é um UPDATE condicional: dois vínculos concorrentes
   * não passam os dois. Depois dele todas as sessões antigas são revogadas e nasce um par novo.
   */
  async linkGuest(
    principal: Principal,
    provider: SocialProvider,
    idToken: string,
    nonce?: string,
  ): Promise<{ readonly user: UserRecord; readonly pair: TokenPair }> {
    if (!this.identity.isEnabled(provider)) throw new SocialAuthError('SOCIAL_LOGIN_DISABLED');
    const current = await this.users.findById(principal.userId);
    if (current === null) throw new AuthError('UNAUTHORIZED');
    if (current.provider !== 'guest') {
      // Retomada: o UPDATE passou, mas a revogação das sessões ou a emissão do par falhou (Redis fora) e o
      // cliente repete. Quem JÁ foi vinculado a este mesmo provedor e prova o mesmo `sub` recebe o par novo
      // (sem gastar o idToken de novo: o primeiro pedido já o consumiu). Qualquer outro caso é 409.
      if (current.linkedAt === null || current.provider !== provider) {
        throw new SocialAuthError('ALREADY_LINKED');
      }
      const same = await this.verifyIdToken(provider, idToken, nonce, false);
      if (same.subject !== current.providerSubject) throw new SocialAuthError('ALREADY_LINKED');
      return { user: current, pair: await this.rotateAllSessions(principal, current.id) };
    }
    const identity = await this.verifyIdToken(provider, idToken, nonce, false);
    if ((await this.users.findByProvider(provider, identity.subject)) !== null) {
      throw new SocialAuthError('PROVIDER_TAKEN');
    }
    await this.claimIdToken(provider, idToken, identity);
    let linked: UserRecord | null;
    try {
      linked = await this.users.linkProvider(current.id, provider, identity.subject);
    } catch (err) {
      if (err instanceof ProviderSubjectTakenError) throw new SocialAuthError('PROVIDER_TAKEN');
      throw err;
    }
    if (linked === null) {
      // Deixou de ser convidado entre a leitura e o UPDATE (vínculo concorrente) ou foi apagado.
      if ((await this.users.findById(current.id)) === null) throw new AuthError('UNAUTHORIZED');
      throw new SocialAuthError('ALREADY_LINKED');
    }
    log.info('auth: convidado vinculado', { provider });
    return { user: linked, pair: await this.rotateAllSessions(principal, linked.id) };
  }

  /**
   * Emite o par novo (família nova) e DEPOIS revoga as demais sessões do usuário e o access apresentado
   * (revogar tudo antes deixaria o cliente sem sessão se a emissão falhasse). O vínculo já está gravado
   * quando isto roda:
   * - emissão falhou (Redis fora): nada foi revogado, a rota responde 503 e o cliente repete
   *   `POST /auth/link` com o mesmo idToken; a retomada (conta já vinculada ao mesmo `sub`) refaz só isto;
   * - revogação falhou: o par novo é devolvido mesmo assim (o cliente não fica preso) e a revogação é
   *   reagendada em memória (3 tentativas com espera crescente); fica no log como pendente.
   */
  private async rotateAllSessions(principal: Principal, userId: string): Promise<TokenPair> {
    const { pair, familyId } = await this.issueFamily(userId);
    try {
      await this.revokeOtherSessions(principal, userId, familyId);
    } catch (err) {
      log.warn('auth: revogação das sessões antigas pendente após o vínculo', {
        error: err instanceof Error ? err.name : 'unknown',
      });
      this.retryRevocation(principal, userId, familyId, 1);
    }
    return pair;
  }

  private async revokeOtherSessions(
    principal: Principal,
    userId: string,
    keepFamilyId: string,
  ): Promise<void> {
    for (const jti of await this.tokens.revokeAllForUser(userId, keepFamilyId)) {
      await this.tokens.revokeJti(jti, this.cfg.accessTtlSec);
    }
    await this.tokens.revokeJti(principal.jti, this.cfg.accessTtlSec);
  }

  private retryRevocation(
    principal: Principal,
    userId: string,
    keepFamilyId: string,
    attempt: number,
  ): void {
    if (attempt > REVOKE_RETRIES) {
      log.error('auth: revogação das sessões antigas desistiu após o vínculo');
      return;
    }
    const timer = setTimeout(() => {
      this.revokeOtherSessions(principal, userId, keepFamilyId).then(
        () => log.info('auth: revogação pendente concluída', { attempt }),
        () => this.retryRevocation(principal, userId, keepFamilyId, attempt + 1),
      );
    }, this.revokeRetryMs * attempt);
    timer.unref();
  }

  /** Cria o usuário convidado (apelido gerado, válido e único) e abre uma família de refresh. */
  async createGuest(): Promise<{ readonly user: UserRecord; readonly pair: TokenPair }> {
    let user: UserRecord | null = null;
    for (let i = 0; i < GUEST_ATTEMPTS && user === null; i++) {
      try {
        user = await this.users.createGuest({
          providerSubject: randomUUID(),
          nickname: `Visitante${randomInt(1000, 10_000_000)}`,
        });
      } catch (err) {
        if (!(err instanceof NicknameTakenError || err instanceof ProviderSubjectTakenError)) {
          throw err;
        }
      }
    }
    if (user === null) throw new AuthError('SERVICE_UNAVAILABLE');
    return { user, pair: await this.issuePair(user.id) };
  }

  /**
   * Rotaciona: o refresh apresentado morre e um novo par nasce. Toda falha é `INVALID_REFRESH_TOKEN`,
   * sem distinguir causa.
   *
   * Janela de graça (`refreshReuseGraceSec`): resposta perdida ou duas abas fazem o cliente reapresentar o
   * token que ACABOU de rotacionar. Só o hash é guardado, então não dá para reemitir o MESMO sucessor
   * (guardá-lo, mesmo cifrado, deixaria um token utilizável no Redis). Dentro da janela, UMA vez por
   * token, nasce um sucessor irmão e o primeiro segue válido (a cadeia bifurca; o ramo que o cliente
   * perdeu é inofensivo). Custo de segurança: um ladrão do token antigo que o apresente nos primeiros
   * segundos ganha um ramo, limitado a uma vez e à janela; fora dela, ou na segunda reapresentação, é
   * reuso e a família inteira é revogada (com o access vigente).
   *
   * O usuário é validado ANTES de rotacionar: se o banco falhar, o token não é gasto.
   */
  async refresh(presented: string): Promise<TokenPair> {
    if (typeof presented !== 'string' || !REFRESH_FORMAT.test(presented)) {
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    const presentedHash = hashRefresh(presented);
    const owner = await this.tokens.lookup(presentedHash);
    if (owner === null) throw new AuthError('INVALID_REFRESH_TOKEN');
    const user = await this.users.findById(owner.userId);
    if (user === null) {
      await this.revokeFamilyAndAccess(owner.familyId);
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    const refreshToken = newRefresh();
    const newJti = randomUUID();
    const result = await this.tokens.rotate({
      refreshHash: presentedHash,
      newRefreshHash: hashRefresh(refreshToken),
      newJti,
      ttlSec: this.cfg.refreshTtlSec,
      graceSec: this.cfg.refreshReuseGraceSec,
      familyMaxSec: this.cfg.refreshFamilyMaxSec,
    });
    if (result.status === 'reuse') {
      if (result.lastJti !== null)
        await this.tokens.revokeJti(result.lastJti, this.cfg.accessTtlSec);
      log.warn('auth: reuso de refresh token, família revogada', {
        user: result.userId,
        family: result.familyId,
      });
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    if (result.status === 'revoked') {
      log.warn('auth: refresh de família revogada', { user: result.userId });
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    if (result.status !== 'rotated') throw new AuthError('INVALID_REFRESH_TOKEN');
    if (result.graced === true) {
      log.info('auth: refresh reapresentado na janela de graça', { user: result.userId });
    }
    const access = await this.jwt.sign(user.id, newJti);
    return { accessToken: access.token, refreshToken, expiresIn: this.cfg.accessTtlSec };
  }

  /**
   * Logout do usuário autenticado (`principal` vem do JWT, nunca do corpo). Sempre revoga o `jti` vigente
   * do access. Com `all`, revoga todas as famílias do usuário. Com `refreshToken`, revoga a família dele
   * SÓ se ela pertencer a `principal.userId`; token malformado, desconhecido ou de outro usuário é um
   * no-op silencioso (sem oráculo de existência e sem permitir que A derrube a sessão de B). Idempotente.
   */
  async logout(
    principal: Principal,
    input: { readonly refreshToken: string } | { readonly all: true },
  ): Promise<void> {
    if ('all' in input) {
      // Também mata o access vigente (`lastJti`) de cada família: o de OUTROS aparelhos não pode
      // sobreviver até o TTL.
      for (const jti of await this.tokens.revokeAllForUser(principal.userId)) {
        await this.tokens.revokeJti(jti, this.cfg.accessTtlSec);
      }
    } else if (REFRESH_FORMAT.test(input.refreshToken)) {
      const owner = await this.tokens.lookup(hashRefresh(input.refreshToken));
      if (owner !== null && owner.userId === principal.userId) {
        await this.revokeFamilyAndAccess(owner.familyId);
      }
    }
    await this.tokens.revokeJti(principal.jti, this.cfg.accessTtlSec);
  }

  /**
   * Prova de acesso recente para ações destrutivas (`DELETE /me`): o refresh apresentado tem de ser VIVO
   * (não usado, família não revogada nem expirada) e do próprio `userId`. NÃO rotaciona nem gasta o token:
   * se a ação falhar depois (banco fora), a sessão do cliente fica intacta. Falha = `INVALID_REFRESH_TOKEN`,
   * sem distinguir a causa.
   */
  async assertRecentRefresh(userId: string, presented: string): Promise<void> {
    if (typeof presented !== 'string' || !REFRESH_FORMAT.test(presented)) {
      throw new AuthError('INVALID_REFRESH_TOKEN');
    }
    const owner = await this.tokens.peekLive(hashRefresh(presented));
    if (owner === null || owner.userId !== userId) throw new AuthError('INVALID_REFRESH_TOKEN');
  }

  /** Revoga a família e o access vigente dela (`lastJti`), se acabou de ser revogada. */
  private async revokeFamilyAndAccess(familyId: string): Promise<void> {
    const lastJti = await this.tokens.revokeFamily(familyId);
    if (lastJti !== null) await this.tokens.revokeJti(lastJti, this.cfg.accessTtlSec);
  }

  /** Valida o access JWT (assinatura, `iss`, `aud`, `exp`) e a lista de `jti` revogados. */
  async authenticateAccess(token: string): Promise<Principal> {
    let claims;
    try {
      claims = await this.jwt.verify(token);
    } catch (err) {
      if (err instanceof InvalidTokenError) throw new AuthError('UNAUTHORIZED');
      throw err;
    }
    if (await this.tokens.isJtiRevoked(claims.jti)) throw new AuthError('UNAUTHORIZED');
    return { userId: claims.userId, jti: claims.jti };
  }
}

/** Extrai o token de `Authorization: Bearer <token>` (esquema exato, um único espaço). */
export function bearerFromHeader(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('Bearer ')) return undefined;
  const token = value.slice(7);
  return token.length > 0 && !/\s/.test(token) ? token : undefined;
}

// Constante vive no protocol (cliente e servidor); reexportada para quem importava daqui.
export { WS_BEARER_PROTOCOL };
export function bearerFromSubprotocol(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const parts = value.split(',').map((p) => p.trim());
  const i = parts.indexOf(WS_BEARER_PROTOCOL);
  const token = i === -1 ? undefined : parts[i + 1];
  return token !== undefined && token.length > 0 ? token : undefined;
}
