/**
 * Cliente HTTP mínimo (Node) do servidor do E2E, para semear contas e conferir efeitos no servidor SEM
 * passar pela UI (o que a UI mostra é o que os testes verificam; o que ficou gravado, estas chamadas).
 * Nunca registra token. Só fala com `SERVER_URL` (127.0.0.1).
 */
import type { BrowserContext, Page } from '@playwright/test';
import { SERVER_URL } from './env';

export interface Pair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

export interface Account extends Pair {
  readonly id: string;
  readonly nickname: string;
}

export interface ApiReply {
  readonly status: number;
  readonly json: unknown;
}

export async function call(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<ApiReply> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.token !== undefined ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text === '' ? null : JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}

interface AccountBody {
  accessToken: string;
  refreshToken: string;
  user: { id: string; nickname: string };
}

const asAccount = (r: ApiReply, expected: number): Account => {
  if (r.status !== expected) throw new Error(`esperava ${expected}, veio ${r.status}`);
  const b = r.json as AccountBody;
  return {
    accessToken: b.accessToken,
    refreshToken: b.refreshToken,
    id: b.user.id,
    nickname: b.user.nickname,
  };
};

export async function createGuest(): Promise<Account> {
  return asAccount(await call('POST', '/auth/guest', { body: {} }), 201);
}

/** Token de identidade do verificador de teste (`AUTH_TEST_IDENTITY=1`): `test:<sub>[:<sufixo>]`. */
export const testIdToken = (sub: string, suffix = ''): string =>
  suffix === '' ? `test:${sub}` : `test:${sub}:${suffix}`;

/** `POST /auth/google` com o verificador de teste. Conta nova = 201, existente = 200. */
export async function loginGoogle(sub: string, suffix = ''): Promise<ApiReply> {
  return call('POST', '/auth/google', {
    body: { provider: 'google', idToken: testIdToken(sub, suffix) },
  });
}

export const accountOf = (r: ApiReply): Account => asAccount(r, r.status);

export async function linkGoogle(token: string, sub: string, suffix = ''): Promise<ApiReply> {
  return call('POST', '/auth/link', {
    token,
    body: { provider: 'google', idToken: testIdToken(sub, suffix) },
  });
}

/** Subs únicos por execução: o banco do E2E pode ser reaproveitado entre execuções. */
export const uniqueSub = (label: string): string =>
  `${label}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

const STORAGE_KEY = 'trucaco.session.v1';

/**
 * Entra no app como a conta dada: grava a sessão no `localStorage` ANTES de a página carregar (mesmo
 * formato do `tokenStorage.web`). Vale para as próximas navegações do contexto.
 */
export async function signInContext(context: BrowserContext, acc: Account): Promise<void> {
  await context.addInitScript(
    ([key, value]) => {
      // Semeia uma vez por aba (sessionStorage sobrevive ao reload): o reload não desfaz a rotação do
      // refresh feita pelo app nem ressuscita uma conta apagada ou deslogada.
      if (window.sessionStorage.getItem('e2e.seeded') !== null) return;
      window.sessionStorage.setItem('e2e.seeded', '1');
      window.localStorage.setItem(key, value);
    },
    [
      STORAGE_KEY,
      JSON.stringify({
        refreshToken: acc.refreshToken,
        userId: acc.id,
        nickname: acc.nickname,
      }),
    ] as const,
  );
}

/** Sessão guardada hoje no navegador (ou `null`). */
export async function storedSession(page: Page): Promise<{ userId: string } | null> {
  const raw = await page.evaluate((k) => window.localStorage.getItem(k), STORAGE_KEY);
  return raw === null ? null : (JSON.parse(raw) as { userId: string });
}
