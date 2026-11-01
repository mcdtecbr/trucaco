import { AuthService } from './auth/authService';
import { loadServerConfig } from './auth/config';
import { RedisTokenStore } from './auth/redisTokenStore';
import { MemoryTokenStore, type TokenStore } from './auth/tokenStore';
import { createMemoryRepositories, createPrisma, PrismaUserRepository } from './db';
import type { PrismaHandle, UserRepository } from './db';
import { log } from './logger';
import { createServer } from './server';

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
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl !== undefined && databaseUrl !== '') {
    prismaHandle = createPrisma(databaseUrl);
    users = new PrismaUserRepository(prismaHandle.prisma);
  } else if (config.devLike) {
    log.warn('DATABASE_URL ausente: usuários em memória (só dev/test)');
    users = createMemoryRepositories().users;
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
