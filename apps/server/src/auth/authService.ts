/**
 * Casos de uso de autenticação: criar convidado, rotacionar refresh e autenticar access token.
 * Sem HTTP aqui. Refresh token: 32 bytes aleatórios em base64url (opaco); só o SHA-256 vai ao store.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WS_BEARER_PROTOCOL } from '@trucaco/protocol';
import { log } from '../logger';
import {
  NicknameTakenError,
  ProviderSubjectTakenError,
  type UserRecord,
  type UserRepository,
} from '../db/types';
import type { AuthConfig } from './config';
import { AccessTokenService, InvalidTokenError } from './jwt';
import type { TokenStore } from './tokenStore';

export type AuthErrorCode = 'UNAUTHORIZED' | 'INVALID_REFRESH_TOKEN' | 'SERVICE_UNAVAILABLE';

export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode) {
    super(code);
    this.name = 'AuthError';
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

export const hashRefresh = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const newRefresh = (): string => randomBytes(32).toString('base64url');

export class AuthService {
  readonly jwt: AccessTokenService;

  constructor(
    private readonly users: UserRepository,
    private readonly tokens: TokenStore,
    private readonly cfg: AuthConfig,
    now: () => number = Date.now,
  ) {
    this.jwt = new AccessTokenService(cfg, now);
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
    const refreshToken = newRefresh();
    const access = await this.jwt.sign(user.id);
    await this.tokens.createFamily({
      familyId: randomUUID(),
      userId: user.id,
      refreshHash: hashRefresh(refreshToken),
      jti: access.jti,
      ttlSec: Math.min(this.cfg.refreshTtlSec, this.cfg.refreshFamilyMaxSec),
    });
    return {
      user,
      pair: { accessToken: access.token, refreshToken, expiresIn: this.cfg.accessTtlSec },
    };
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
      await this.tokens.revokeFamily(owner.familyId);
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
      await this.tokens.revokeAllForUser(principal.userId);
    } else if (REFRESH_FORMAT.test(input.refreshToken)) {
      const owner = await this.tokens.lookup(hashRefresh(input.refreshToken));
      if (owner !== null && owner.userId === principal.userId) {
        await this.tokens.revokeFamily(owner.familyId);
      }
    }
    await this.tokens.revokeJti(principal.jti, this.cfg.accessTtlSec);
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
