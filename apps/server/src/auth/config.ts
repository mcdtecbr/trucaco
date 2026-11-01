/**
 * Configuração de auth e REST lida do ambiente. Falha FECHADO: sem `JWT_SECRET` válido o servidor não
 * sobe, salvo com `NODE_ENV` explicitamente `development` ou `test` (segredo efêmero em memória, que
 * morre no restart). O segredo só vem do ambiente; nunca há valor padrão.
 */
import { randomBytes } from 'node:crypto';

export interface AuthConfig {
  /** Chave HS256 (bytes). Mínimo de 32 bytes. */
  readonly secret: Uint8Array;
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSec: number;
  readonly refreshTtlSec: number;
  /** Tolerância de relógio na verificação do JWT (segundos). */
  readonly clockToleranceSec: number;
}

export interface RestLimits {
  /** `POST /auth/guest` por IP por hora. */
  readonly guestPerIpPerHour: number;
  /** `POST /auth/guest` no servidor inteiro por hora (teto contra criação em massa). */
  readonly guestGlobalPerHour: number;
  /** `POST /auth/refresh` por IP por minuto. */
  readonly refreshPerIpPerMin: number;
  /** Qualquer rota REST por IP por minuto. */
  readonly perIpPerMin: number;
  /** Rotas autenticadas por `userId` por minuto. */
  readonly perUserPerMin: number;
}

export interface ServerConfig {
  readonly nodeEnv: string | undefined;
  /** `development`/`test` explícitos. */
  readonly devLike: boolean;
  readonly auth: AuthConfig;
  /** `null` = tokens em memória (só dev/test). */
  readonly redisUrl: string | null;
  readonly corsOrigins: readonly string[];
  readonly trustProxy: boolean;
  readonly limits: RestLimits;
}

export const JWT_SECRET_MIN_BYTES = 32;
/** Prefixo do valor de exemplo do `.env.example`: recusado fora de dev/test. */
const PLACEHOLDER_PREFIX = 'troque-por';

export const DEFAULT_LIMITS: RestLimits = {
  guestPerIpPerHour: 10,
  guestGlobalPerHour: 2000,
  refreshPerIpPerMin: 30,
  perIpPerMin: 120,
  perUserPerMin: 60,
};

export const isDevLike = (nodeEnv: string | undefined): boolean =>
  nodeEnv === 'development' || nodeEnv === 'test';

type Env = Readonly<Record<string, string | undefined>>;

function intInRange(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} inválida (inteiro de ${min} a ${max}).`);
  }
  return n;
}

function parseOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o !== '')
    .map((o) => {
      let url: URL;
      try {
        url = new URL(o);
      } catch {
        throw new Error('CORS_ORIGINS contém origem inválida.');
      }
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.origin !== o) {
        throw new Error(
          'CORS_ORIGINS deve listar origens exatas (esquema://host[:porta]), sem "*".',
        );
      }
      return o;
    });
}

function resolveSecret(env: Env, devLike: boolean): Uint8Array {
  const raw = env['JWT_SECRET'];
  if (raw === undefined || raw === '') {
    if (devLike) return new Uint8Array(randomBytes(JWT_SECRET_MIN_BYTES));
    throw new Error('JWT_SECRET é obrigatório (sem valor padrão) fora de development/test.');
  }
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length < JWT_SECRET_MIN_BYTES) {
    throw new Error(`JWT_SECRET precisa ter pelo menos ${JWT_SECRET_MIN_BYTES} bytes.`);
  }
  if (!devLike && raw.startsWith(PLACEHOLDER_PREFIX)) {
    throw new Error('JWT_SECRET ainda é o valor de exemplo do .env.example.');
  }
  return bytes;
}

export function loadServerConfig(env: Env = process.env): ServerConfig {
  const nodeEnv = env['NODE_ENV'];
  const devLike = isDevLike(nodeEnv);
  const redisRaw = env['REDIS_URL'];
  let redisUrl: string | null = null;
  if (redisRaw !== undefined && redisRaw !== '') {
    if (!/^rediss?:\/\//.test(redisRaw))
      throw new Error('REDIS_URL deve ser redis:// ou rediss://.');
    redisUrl = redisRaw;
  } else if (!devLike) {
    throw new Error('REDIS_URL é obrigatório fora de development/test (refresh tokens).');
  }
  return {
    nodeEnv,
    devLike,
    auth: {
      secret: resolveSecret(env, devLike),
      issuer: env['JWT_ISSUER'] || 'trucaco',
      audience: env['JWT_AUDIENCE'] || 'trucaco-api',
      accessTtlSec: intInRange(env, 'ACCESS_TOKEN_TTL_SECONDS', 900, 60, 3600),
      refreshTtlSec: intInRange(env, 'REFRESH_TOKEN_TTL_SECONDS', 2_592_000, 3600, 7_776_000),
      clockToleranceSec: 5,
    },
    redisUrl,
    corsOrigins: parseOrigins(env['CORS_ORIGINS']),
    trustProxy: env['TRUST_PROXY'] === 'true',
    limits: {
      guestPerIpPerHour: intInRange(
        env,
        'AUTH_GUEST_PER_IP_PER_HOUR',
        DEFAULT_LIMITS.guestPerIpPerHour,
        1,
        10_000,
      ),
      guestGlobalPerHour: intInRange(
        env,
        'AUTH_GUEST_GLOBAL_PER_HOUR',
        DEFAULT_LIMITS.guestGlobalPerHour,
        1,
        1_000_000,
      ),
      refreshPerIpPerMin: intInRange(
        env,
        'AUTH_REFRESH_PER_IP_PER_MIN',
        DEFAULT_LIMITS.refreshPerIpPerMin,
        1,
        10_000,
      ),
      perIpPerMin: intInRange(env, 'REST_PER_IP_PER_MIN', DEFAULT_LIMITS.perIpPerMin, 1, 100_000),
      perUserPerMin: intInRange(
        env,
        'REST_PER_USER_PER_MIN',
        DEFAULT_LIMITS.perUserPerMin,
        1,
        100_000,
      ),
    },
  };
}
