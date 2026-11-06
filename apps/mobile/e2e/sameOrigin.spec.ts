/**
 * E2E web na MESMA ORIGEM (topologia do beta, 7A): o servidor serve o export do Expo (`WEB_DIST_DIR`) e a
 * API no mesmo host:porta, sem CORS. Aqui `/auth/*` sai com `credentials: 'same-origin'` (nunca `omit`, que
 * faria o navegador descartar o `Set-Cookie`). Também confere que um asset do expo-router sob
 * `/assets/__node_modules/.pnpm/...` (caminho com ponto) responde 200 pelo `mountWeb`.
 */
import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { LEGACY_STORAGE_KEY } from './support/api';
import { SAME_DIST_DIR, SAME_URL } from './support/env';

/** Primeiro arquivo do export sob `assets/__node_modules/.pnpm/` (caminho com `.pnpm`, dotfile). */
function pnpmAssetUrl(): string {
  const root = resolve(__dirname, '..', SAME_DIST_DIR);
  const base = join(root, 'assets', '__node_modules', '.pnpm');
  const walk = (dir: string): string | null => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        const found = walk(full);
        if (found !== null) return found;
      } else if (name.endsWith('.png')) return full;
    }
    return null;
  };
  const file = walk(base);
  if (file === null) throw new Error('nenhum asset em assets/__node_modules/.pnpm no export');
  return '/' + relative(root, file).split(sep).join('/');
}

test.describe('web na mesma origem (WEB_DIST_DIR)', () => {
  test('convidado entra, o cookie fica, e o reload mantém a mesma conta', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: SAME_URL });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    try {
      await page.goto('/');
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });

      const cookie = (await context.cookies(`${SAME_URL}/auth/refresh`)).find(
        (c) => c.name === 'refresh',
      );
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/auth' });
      const read = (): Promise<string> =>
        page.evaluate(() => JSON.stringify(Object.entries(window.localStorage)));
      const before = await read();
      expect(before).not.toMatch(/refresh/i);
      expect(
        await page.evaluate((k) => window.localStorage.getItem(k), LEGACY_STORAGE_KEY),
      ).toBeNull();
      const userId = (
        JSON.parse(
          await page.evaluate(() => window.localStorage.getItem('trucaco.session.v2') ?? 'null'),
        ) as { userId: string } | null
      )?.userId;
      expect(userId).toBeTruthy();

      const refresh = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/auth/refresh' && r.request().method() === 'POST',
      );
      await page.reload();
      expect((await refresh).status()).toBe(200); // o cookie foi enviado: sem 401 e sem convidado novo
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
      expect(
        (
          JSON.parse(
            await page.evaluate(() => window.localStorage.getItem('trucaco.session.v2') ?? 'null'),
          ) as { userId: string } | null
        )?.userId,
      ).toBe(userId);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('asset do expo-router sob /assets/__node_modules/.pnpm/ responde 200; rota de página cai no index', async ({
    request,
  }) => {
    const asset = await request.get(`${SAME_URL}${pnpmAssetUrl()}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['content-type']).toContain('image/png');
    const page = await request.get(`${SAME_URL}/profile`);
    expect(page.status()).toBe(200);
    expect(await page.text()).toContain('<div id="root">');
  });
});
