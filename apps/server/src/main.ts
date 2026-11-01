import { AuthService } from './auth/authService';
import { loadServerConfig } from './auth/config';
import { RedisTokenStore } from './auth/redisTokenStore';
import { MemoryTokenStore, type TokenStore } from './auth/tokenStore';
import {
  createMemoryRepositories,
  createPrisma,
  PrismaMatchRepository,
  PrismaUserRepository,
} from './db';
import type { MatchRepository, PrismaHandle, UserRepository } from './db';
import { log } from './logger';
import { createServer } from './server';
import type { ServerDeps } from './server';

const DEFAULT_PORT = 2567;

function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT inválida: ${raw}`);
  }
  return port;
}

/**
 * Modo de desenvolvimento por opt-in EXPLÍCITO (`--dev`), portátil entre shells. Sem o argumento e sem
 * `NODE_ENV=development|test`, o `devAuth` da sala fica desligado. O Docker nunca passa `--dev` e define
 * `NODE_ENV=production`.
 */
function applyDevFlag(): void {
  if (process.argv.includes('--dev') && process.env.NODE_ENV === undefined) {
    process.env.NODE_ENV = 'development';
  }
}

function positiveInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} inválida: ${raw}`);
  return n;
}

function nonNegativeInt(raw: string | undefined, name: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} inválida: ${raw}`);
  return n;
}

/** Ajustes do lobby por ambiente (segundos nas variáveis, ms no código). Ausente = padrão. */
function lobbyConfig(): NonNullable<ServerDeps['lobby']> {
  const sec = (name: string): number | undefined => {
    const n = positiveInt(process.env[name], name);
    return n === undefined ? undefined : n * 1000;
  };
  const queueTtlMs = sec('LOBBY_QUEUE_TTL_SECONDS');
  const fillMs = sec('LOBBY_FILL_SECONDS');
  const lockMs = sec('JOIN_LOCK_SECONDS');
  const attemptsPerUserPerMin = positiveInt(
    process.env.JOIN_ATTEMPTS_PER_USER_PER_MIN,
    'JOIN_ATTEMPTS_PER_USER_PER_MIN',
  );
  const attemptsPerIpPerMin = positiveInt(
    process.env.JOIN_ATTEMPTS_PER_IP_PER_MIN,
    'JOIN_ATTEMPTS_PER_IP_PER_MIN',
  );
  const failLockThreshold = positiveInt(
    process.env.JOIN_FAIL_LOCK_THRESHOLD,
    'JOIN_FAIL_LOCK_THRESHOLD',
  );
  const cooldownSec = nonNegativeInt(
    process.env.QUEUE_REENTRY_COOLDOWN_SECONDS,
    'QUEUE_REENTRY_COOLDOWN_SECONDS',
  );
  const joinMinLatencyMs = nonNegativeInt(process.env.JOIN_MIN_LATENCY_MS, 'JOIN_MIN_LATENCY_MS');
  const failsPerPrefix48 = positiveInt(
    process.env.JOIN_FAILS_PER_IPV6_48,
    'JOIN_FAILS_PER_IPV6_48',
  );
  const failsGlobal = positiveInt(process.env.JOIN_FAILS_GLOBAL, 'JOIN_FAILS_GLOBAL');
  return {
    ...(queueTtlMs !== undefined ? { queueTtlMs } : {}),
    ...(fillMs !== undefined ? { fillMs } : {}),
    ...(cooldownSec !== undefined ? { queueReentryCooldownMs: cooldownSec * 1000 } : {}),
    ...(joinMinLatencyMs !== undefined ? { joinMinLatencyMs } : {}),
    guard: {
      ...(failsPerPrefix48 !== undefined ? { failsPerPrefix48 } : {}),
      ...(failsGlobal !== undefined ? { failsGlobal } : {}),
      ...(lockMs !== undefined ? { lockMs } : {}),
      ...(attemptsPerUserPerMin !== undefined ? { attemptsPerUserPerMin } : {}),
      ...(attemptsPerIpPerMin !== undefined ? { attemptsPerIpPerMin } : {}),
      ...(failLockThreshold !== undefined ? { failLockThreshold } : {}),
    },
  };
}

async function main(): Promise<void> {
  applyDevFlag();
  const devFlag = process.argv.includes('--dev');
  // Falha FECHADO: sem JWT_SECRET (ou REDIS_URL/DATABASE_URL) válidos fora de dev/test, não sobe.
  const config = loadServerConfig(process.env);
  if (config.devLike && (process.env.JWT_SECRET ?? '') === '') {
    log.warn('JWT_SECRET ausente: segredo efêmero em memória (tokens morrem no restart)');
  }

  let tokens: TokenStore;
  if (config.redisUrl !== null) {
    const redis = new RedisTokenStore(config.redisUrl);
    await redis.ping();
    tokens = redis;
  } else {
    log.warn('REDIS_URL ausente: refresh tokens em memória (só dev/test)');
    tokens = new MemoryTokenStore();
  }

  let prismaHandle: PrismaHandle | null = null;
  let users: UserRepository;
  let matches: MatchRepository;
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== '') {
    prismaHandle = createPrisma(databaseUrl);
    users = new PrismaUserRepository(prismaHandle.prisma);
    matches = new PrismaMatchRepository(prismaHandle.prisma);
  } else if (config.devLike) {
    log.warn('DATABASE_URL ausente: usuários e partidas em memória (só dev/test)');
    const memory = createMemoryRepositories();
    users = memory.users;
    matches = memory.matches;
  } else {
    throw new Error('DATABASE_URL é obrigatório fora de development/test.');
  }
  const auth = new AuthService(users, tokens, config.auth);

  const max = positiveInt(process.env.MATCHMAKE_RATE_LIMIT_PER_MIN, 'MATCHMAKE_RATE_LIMIT_PER_MIN');
  const server = await createServer({
    port: resolvePort(process.env.PORT),
    matchmakeLimit: {
      ...(max !== undefined ? { max } : {}),
      trustProxy: config.trustProxy,
    },
    deps: {
      auth,
      users,
      matches,
      lobby: lobbyConfig(),
      corsOrigins: config.corsOrigins,
      limits: config.limits,
      trustProxy: config.trustProxy,
      allowDevAuth: devFlag && config.devLike,
    },
  });
  console.log(JSON.stringify({ level: 'info', msg: 'server listening', port: server.port }));

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ level: 'info', msg: 'shutting down', signal }));
    server
      .close()
      .then(() => Promise.all([tokens.close(), prismaHandle?.close()]))
      .then(
        () => process.exit(0),
        (err: unknown) => {
          console.error(
            JSON.stringify({ level: 'error', msg: 'shutdown failed', err: String(err) }),
          );
          process.exit(1);
        },
      );
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'error', msg: 'startup failed', err: String(err) }));
  process.exit(1);
});
