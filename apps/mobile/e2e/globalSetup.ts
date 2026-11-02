/**
 * Sobe tudo o que o E2E precisa e devolve o teardown:
 * 1. build web estático do app com `EXPO_PUBLIC_E2E=1` (sonda `table-state`) e a URL do servidor de teste;
 * 2. servidor do jogo REAL (`apps/server/dist/main.js`, NODE_ENV=test);
 * 3. servidor estático do build.
 * `E2E_SKIP_BUILD=1` reaproveita `dist-e2e/` (iteração local rápida; o CI NÃO usa: é este setup que
 * constrói o web, e o job só anexa o `dist-e2e/` resultante como artefato).
 * Pré-requisito: `pnpm build` na raiz (pacotes `@trucaco/*` e `apps/server/dist`).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { SERVER_PORT, SERVER_URL, WEB_DIST_DIR, WEB_PORT, WEB_URL } from './support/env';
import { startGameServer } from './support/serverProcess';
import { startStaticServer } from './support/staticServer';

const MOBILE_ROOT = resolve(__dirname, '..');

function buildWeb(): Promise<void> {
  // CLI do Expo resolvido direto (sem shim do pnpm/npx, que variam entre Windows e Linux).
  const expoCli = require.resolve('expo/bin/cli');
  return new Promise<void>((done, fail) => {
    const child = spawn(
      process.execPath,
      [expoCli, 'export', '--platform', 'web', '--output-dir', WEB_DIST_DIR, '--clear'],
      {
        cwd: MOBILE_ROOT,
        env: {
          ...process.env,
          CI: '1',
          EXPO_PUBLIC_E2E: '1',
          EXPO_PUBLIC_SERVER_URL: SERVER_URL,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let log = '';
    const keep = (c: Buffer): void => {
      log = (log + c.toString('utf8')).slice(-4000);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.once('error', fail);
    child.once('exit', (code) => {
      if (code === 0) done();
      else fail(new Error(`expo export falhou (código ${String(code)}):\n${log}`));
    });
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  const distDir = resolve(MOBILE_ROOT, WEB_DIST_DIR);
  if (process.env['E2E_SKIP_BUILD'] === '1') {
    if (!existsSync(resolve(distDir, 'index.html'))) {
      throw new Error(`E2E_SKIP_BUILD=1 mas ${WEB_DIST_DIR}/index.html não existe`);
    }
  } else {
    await buildWeb();
  }

  const server = await startGameServer({ port: SERVER_PORT, corsOrigin: WEB_URL });
  let web: Awaited<ReturnType<typeof startStaticServer>>;
  try {
    web = await startStaticServer(distDir, WEB_PORT);
  } catch (e) {
    await server.stop();
    throw e;
  }
  return async () => {
    await web.close();
    await server.stop();
  };
}
