/**
 * Access token (JWT HS256, curto). Emissão e verificação com `jose`. A verificação SEMPRE restringe
 * `algorithms` (fecha `alg:none` e confusão de algoritmo), confere `iss`, `aud`, `exp` (com tolerância
 * pequena) e exige `sub` UUID e `jti`. Nada aqui lê o banco ou o Redis.
 */
import { randomUUID } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import { normalizeId } from '../db/validation';
import type { AuthConfig } from './config';

const ALG = 'HS256';
/** Um JWT nosso tem ~250 caracteres; acima disso nem tenta verificar. */
const MAX_TOKEN_LENGTH = 1024;

export class InvalidTokenError extends Error {
  constructor() {
    super('Token inválido.');
    this.name = 'InvalidTokenError';
  }
}

export interface AccessClaims {
  readonly userId: string;
  readonly jti: string;
  /** Segundos desde a época. */
  readonly exp: number;
}

export interface SignedAccess {
  readonly token: string;
  readonly jti: string;
  readonly exp: number;
}

export class AccessTokenService {
  constructor(
    private readonly cfg: AuthConfig,
    private readonly now: () => number = Date.now,
  ) {}

  async sign(userId: string, jti: string = randomUUID()): Promise<SignedAccess> {
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + this.cfg.accessTtlSec;
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: ALG, typ: 'JWT' })
      .setIssuer(this.cfg.issuer)
      .setAudience(this.cfg.audience)
      .setSubject(normalizeId(userId))
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.cfg.secret);
    return { token, jti, exp };
  }

  /** Lança `InvalidTokenError` para qualquer falha (sem detalhe: nada de oráculo para o cliente). */
  async verify(token: string): Promise<AccessClaims> {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw new InvalidTokenError();
    }
    try {
      const { payload } = await jwtVerify(token, this.cfg.secret, {
        algorithms: [ALG],
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        clockTolerance: this.cfg.clockToleranceSec,
        requiredClaims: ['sub', 'jti', 'exp', 'iat'],
        currentDate: new Date(this.now()),
      });
      const { sub, jti, exp } = payload;
      if (typeof sub !== 'string' || typeof jti !== 'string' || typeof exp !== 'number') {
        throw new InvalidTokenError();
      }
      if (jti.length < 8 || jti.length > 64) throw new InvalidTokenError();
      return { userId: normalizeId(sub), jti, exp };
    } catch {
      throw new InvalidTokenError();
    }
  }
}
