import { defineConfig, devices } from '@playwright/test';
import { WEB_URL } from './e2e/support/env';

/**
 * E2E web (Chromium). Cada teste abre 4 contextos de navegador (um convidado por jogador) numa mesa
 * real, contra o servidor `apps/server/dist/main.js`. Tudo sobe em `e2e/globalSetup.ts`.
 * Rode com `pnpm --filter @trucaco/mobile test:e2e` (precisa de `pnpm build` antes).
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/globalSetup.ts',
  // Um worker: o servidor é um só e a mesa de cada teste usa 4 navegadores.
  fullyParallel: false,
  workers: 1,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] !== undefined ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter:
    process.env['CI'] !== undefined
      ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
      : [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: WEB_URL,
    // Largura >= 900: layout web largo (placar, histórico e vira na lateral).
    ...devices['Desktop Chrome'],
    viewport: { width: 1280, height: 900 },
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium' }],
});
