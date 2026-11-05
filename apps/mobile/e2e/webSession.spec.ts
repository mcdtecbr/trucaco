/**
 * E2E web da Fase 7A: sessão por cookie httpOnly. O refresh nunca passa pelo JavaScript da página: vive em
 * `Set-Cookie` (`HttpOnly; SameSite=Strict; Path=/auth`), a página guarda só `{ userId, nickname }` e a
 * restauração no boot é um `POST /auth/refresh` com corpo vazio. Servidor e página ficam em portas
 * diferentes do mesmo host (`127.0.0.1`), então o cliente usa `credentials: 'include'`.
 */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { createGuest, call, LEGACY_STORAGE_KEY, signInContext, storedSession } from './support/api';
import { SERVER_PORT, WEB_URL } from './support/env';

async function openFresh(browser: Browser) {
  const context = await browser.newContext({
    baseURL: WEB_URL,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return { context, page, pageErrors };
}

async function refreshCookie(context: BrowserContext) {
  const all = await context.cookies(`http://127.0.0.1:${SERVER_PORT}/auth/refresh`);
  return all.find((c) => c.name === 'refresh');
}

/** Tudo o que a página guarda (localStorage e sessionStorage) como texto, para provar o que NÃO há nele. */
async function everythingStored(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify([
      Object.entries(window.localStorage),
      Object.entries(window.sessionStorage),
      document.cookie,
    ]),
  );
}

test.describe('sessão web por cookie', () => {
  test('convidado novo: cookie httpOnly no servidor, refresh fora do localStorage, reload mantém a conta', async ({
    browser,
  }) => {
    const { context, page, pageErrors } = await openFresh(browser);
    try {
      await page.goto('/');
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });

      const cookie = await refreshCookie(context);
      expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/auth' });
      // O JavaScript da página não enxerga o cookie nem o refresh em lugar nenhum.
      const stored = await everythingStored(page);
      expect(stored).not.toContain(cookie?.value ?? 'x');
      expect(stored).not.toMatch(/refresh/i);
      expect(await page.evaluate((k) => window.localStorage.getItem(k), LEGACY_STORAGE_KEY)).toBe(
        null,
      );
      const before = await storedSession(page);
      expect(before?.userId).toBeTruthy();

      // Reload: a sessão volta pelo cookie (POST /auth/refresh, corpo vazio, X-Client) e é a MESMA conta.
      const refresh = page.waitForRequest(
        (r) => r.method() === 'POST' && new URL(r.url()).pathname === '/auth/refresh',
      );
      await page.reload();
      const req = await refresh;
      expect(req.postData()).toBeNull();
      expect(req.headers()['x-client']).toBe('web');
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
      expect((await storedSession(page))?.userId).toBe(before?.userId);
      // Nenhum convidado novo foi criado no reload.
      const stored2 = await everythingStored(page);
      expect(stored2).not.toMatch(/refresh/i);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('logout limpa o cookie e o usuário guardado; o refresh antigo morre no servidor', async ({
    browser,
  }) => {
    const { context, page, pageErrors } = await openFresh(browser);
    try {
      await page.goto('/');
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
      const first = await storedSession(page);
      const cookieBefore = await refreshCookie(context);
      expect(cookieBefore).toBeDefined();

      await page.getByTestId('open-settings').click();
      const logout = page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/auth/logout' && r.request().method() === 'POST',
      );
      await page.getByTestId('logout').click();
      const res = await logout;
      expect(res.status()).toBe(204);
      expect(res.request().postData()).toBeNull();

      // O cookie antigo foi revogado/limpo. A tela inicial recria um convidado NOVO (outro usuário).
      // (`replace('/')` deixa a home antiga empilhada e oculta sob a nova: só a visível conta.)
      await expect(page.locator('[data-testid="home"]:visible')).toBeVisible({ timeout: 30_000 });
      await expect.poll(async () => (await storedSession(page))?.userId).not.toBe(first?.userId);
      // O refresh antigo (reapresentado no corpo, como o nativo) não vale mais.
      const replay = await call('POST', '/auth/refresh', {
        body: { refreshToken: cookieBefore?.value },
      });
      expect(replay.status).toBe(401);
      expect(await everythingStored(page)).not.toMatch(/refresh/i);
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });

  test('migração: refresh legado no localStorage vira cookie, o valor local some e o reload mantém a conta', async ({
    browser,
  }) => {
    const acc = await createGuest();
    const { context, page, pageErrors } = await openFresh(browser);
    try {
      await signInContext(context, acc); // grava o legado antes da página carregar
      await page.goto('/');
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
      expect((await storedSession(page))?.userId).toBe(acc.id);
      expect(await page.evaluate((k) => window.localStorage.getItem(k), LEGACY_STORAGE_KEY)).toBe(
        null,
      );
      expect(await everythingStored(page)).not.toContain(acc.refreshToken);
      expect(await refreshCookie(context)).toMatchObject({ httpOnly: true });
      await page.reload();
      await expect(page.getByTestId('home')).toBeVisible({ timeout: 30_000 });
      expect((await storedSession(page))?.userId).toBe(acc.id); // mesma conta, pelo cookie
    } finally {
      await context.close();
    }
    expect(pageErrors).toEqual([]);
  });
});
