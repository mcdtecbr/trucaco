import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // @colyseus/core carrega @pm2/io opcionalmente, que chama process.send();
    // em child process isso quebra o canal IPC do Vitest. Threads não têm canal.
    pool: 'threads',
    // Os arquivos de sala (`boot` do @colyseus/testing) não rodam em paralelo: o matchmaker em modo
    // dev compartilha estado entre as threads (boot de um segundo servidor estoura o timeout).
    fileParallelism: false,
    // Testes de integração exigem Postgres: rodam só em `pnpm test:int` (vitest.int.config.ts).
    exclude: [...configDefaults.exclude, '**/*.int.test.ts'],
  },
});
