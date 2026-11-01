import { defineConfig } from 'vitest/config';
import { assertSafeTestDatabaseUrl } from './src/db/testDatabase';

// Integração com Postgres real. Usa TEST_DATABASE_URL (nunca DATABASE_URL): os testes truncam as
// tabelas. A trava recusa host que não seja local e nome de banco sem "test"/"verif", e falha aqui,
// antes de qualquer conexão.
assertSafeTestDatabaseUrl(process.env['TEST_DATABASE_URL']);

export default defineConfig({
  test: {
    pool: 'threads',
    include: ['src/**/*.int.test.ts'],
    // Um banco compartilhado: arquivos em sequência.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
