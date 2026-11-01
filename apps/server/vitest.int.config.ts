import { defineConfig } from 'vitest/config';

// Integração com Postgres real. Exige DATABASE_URL (banco descartável: os testes limpam as tabelas).
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
