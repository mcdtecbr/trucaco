import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

/** Config só da medição de desempenho (4I). Não faz parte de `pnpm test:e2e`. */
export default defineConfig({
  ...base,
  testDir: '.',
  testMatch: '**/*.perf.ts',
  globalSetup: '../globalSetup.ts',
  timeout: 240_000,
  reporter: [['list']],
  outputDir: '../../test-results-perf',
});
