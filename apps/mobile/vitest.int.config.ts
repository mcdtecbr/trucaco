import { defineConfig } from 'vitest/config';

// Integração contra o servidor REAL (processo `apps/server/dist/main.js`, em memória, sem Redis/Postgres).
// Fora do `pnpm test`: rode `pnpm --filter @trucaco/mobile test:int` (exige `pnpm build` antes).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
