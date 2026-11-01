import { defineConfig } from 'vitest/config';
import { assertSafeTestRedisUrl } from './src/auth/testRedis';
import { assertSafeTestDatabaseUrl } from './src/db/testDatabase';

// Integração com serviços REAIS. Cada grupo só roda com a sua variável de teste (nunca DATABASE_URL /
// REDIS_URL): os testes truncam tabelas / apagam chaves `trucaco:v1:`. As travas recusam host que não
// seja local, banco sem "test"/"verif" no nome e DB lógico 0 do Redis; falham aqui, antes de conectar.
const dbUrl = process.env['TEST_DATABASE_URL'];
const redisUrl = process.env['TEST_REDIS_URL'];
if (dbUrl === undefined && redisUrl === undefined) assertSafeTestDatabaseUrl(dbUrl);
if (dbUrl !== undefined) assertSafeTestDatabaseUrl(dbUrl);
if (redisUrl !== undefined) assertSafeTestRedisUrl(redisUrl);

export default defineConfig({
  test: {
    pool: 'threads',
    include: ['src/**/*.int.test.ts'],
    exclude: [
      '**/node_modules/**',
      ...(dbUrl === undefined ? ['src/db/**'] : []),
      ...(redisUrl === undefined ? ['src/auth/**'] : []),
    ],
    // Um banco compartilhado: arquivos em sequência.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
