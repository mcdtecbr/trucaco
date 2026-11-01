import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // @colyseus/core carrega @pm2/io opcionalmente, que chama process.send();
    // em child process isso quebra o canal IPC do Vitest. Threads não têm canal.
    pool: 'threads',
    // Testes de integração exigem Postgres: rodam só em `pnpm test:int` (vitest.int.config.ts).
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
