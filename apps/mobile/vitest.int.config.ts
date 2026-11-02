import { defineConfig } from 'vitest/config';

// Integração contra o servidor REAL (processo `apps/server/dist/main.js`, em memória, sem Redis/Postgres).
// Fora do `pnpm test`: rode `pnpm --filter @trucaco/mobile test:int` (exige `pnpm build` antes).
// A mesa importa `@trucaco/ui` (react-native): no Node vira react-native-web, como no `vitest.config.ts`.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { 'react-native': 'react-native-web' } },
  test: {
    environment: 'node',
    include: ['src/**/*.int.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
