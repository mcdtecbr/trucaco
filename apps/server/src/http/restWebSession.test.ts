/**
 * Sessão do web (7A): refresh em cookie httpOnly, corpo sem `refreshToken`, checagem de `Origin` e
 * `/auth/account`. O nativo (sem `X-Client: web`) segue com o par no corpo e ignora cookie.
 */
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService } from '../auth/authService';
import { DEFAULT_LIMITS, type AuthConfig } from '../auth/config';
import { TestIdentityVerifier } from '../auth/identity';
import { MemoryTokenStore, TokenStoreUnavailableError } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import { setLogSink } from '../logger';
import { installBaseMiddleware, mountFallbacks, mountRest } from './rest';

setLogSink(() => undefined);

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 0,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const ALLOWED = 'https://app.test';
const EVIL = 'https://evil.test';

const running: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(opts: { secureCookies?: boolean } = {}) {
  const repos = createMemoryRepositories();
  const auth = new AuthService(
    repos.users,
    new MemoryTokenStore(),
    CFG,
    Date.now,
    new TestIdentityVerifier('test'),
  );
  const app = express();
  installBaseMiddleware(app, { corsOrigins: [ALLOWED], hsts: false });
  mountRest(app, {
    auth,
    users: repos.users,
    matches: repos.matches,
    progression: repos.progression,
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000 },
    corsOrigins: [ALLOWED],
    trustProxy: false,
    ...(opts.secureCookies === undefined ? {} : { secureCookies: opts.secureCookies }),
  });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  const self = `http://${host}`;
  const call = (
    method: string,
    path: string,
    init: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
  ): Promise<Response> =>
    fetch(`${self}${path}`, {
      method,
      headers: {
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  /** Cabeçalhos de um navegador na mesma origem. */
  const web = (cookie?: string, origin: string | null = self): Record<string, string> => ({
    'x-client': 'web',
    ...(origin === null ? {} : { origin }),
    ...(cookie === undefined ? {} : { cookie: `refresh=${cookie}` }),
  });
  return { call, web, self, auth, repos };
}

const setCookies = (res: Response): string[] => res.headers.getSetCookie();
const refreshCookie = (res: Response): string | undefined =>
  setCookies(res).find((c) => c.startsWith('refresh='));
const cookieValue = (res: Response): string => {
  const c = refreshCookie(res);
  if (c === undefined) throw new Error('sem cookie refresh');
  return c.slice('refresh='.length, c.indexOf(';'));
};
const code = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

describe('cookie do refresh (web)', () => {
  it('guest web: Set-Cookie httpOnly/Strict/Path=/auth e corpo SEM refreshToken', async () => {
    const { call, web } = await start();
    const res = await call('POST', '/auth/guest', { headers: web() });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['refreshToken']).toBeUndefined();
    expect(typeof body['accessToken']).toBe('string');
    expect(body['expiresIn']).toBe(900);
    const cookie = refreshCookie(res) ?? '';
    expect(cookie).toMatch(/^refresh=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain('Max-Age=3600');
    expect(cookie).toContain('Path=/auth');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).not.toContain('Secure');
    expect(cookie).not.toContain('Domain');
  });

  it('Secure ligado fora de dev', async () => {
    const { call, web } = await start({ secureCookies: true });
    const res = await call('POST', '/auth/guest', { headers: web() });
    expect(refreshCookie(res)).toContain('; Secure');
  });

  it('nativo (sem X-Client): par no corpo, nenhum cookie; cookie enviado é ignorado', async () => {
    const { call } = await start();
    const res = await call('POST', '/auth/guest');
    expect(setCookies(res)).toEqual([]);
    const body = (await res.json()) as { refreshToken: string };
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // cookie sem o cabeçalho web não substitui o corpo
    const refresh = await call('POST', '/auth/refresh', {
      headers: { cookie: `refresh=${body.refreshToken}` },
    });
    expect(refresh.status).toBe(400);
    expect(await code(refresh)).toBe('INVALID_BODY');
  });

  it('refresh pelo cookie: rotaciona, devolve cookie novo e nenhum refreshToken no corpo', async () => {
    const { call, web } = await start();
    const first = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    const res = await call('POST', '/auth/refresh', { headers: web(first) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['refreshToken']).toBeUndefined();
    expect(typeof body['accessToken']).toBe('string');
    const second = cookieValue(res);
    expect(second).not.toBe(first);
    // o cookie novo funciona
    expect((await call('POST', '/auth/refresh', { headers: web(second) })).status).toBe(200);
  });

  it('o corpo continua valendo no web quando enviado (sem ler o cookie)', async () => {
    const { call, web, auth } = await start();
    const { pair } = await auth.createGuest();
    const res = await call('POST', '/auth/refresh', {
      headers: web(),
      body: { refreshToken: pair.refreshToken },
    });
    expect(res.status).toBe(200);
    expect(refreshCookie(res)).toBeDefined();
  });

  it('sem cookie ou com cookie inválido: 401 INVALID_REFRESH_TOKEN e o cookie é limpo (inválido)', async () => {
    const { call, web } = await start();
    const none = await call('POST', '/auth/refresh', { headers: web() });
    expect(none.status).toBe(401);
    expect(await code(none)).toBe('INVALID_REFRESH_TOKEN');
    const bad = await call('POST', '/auth/refresh', { headers: web('x'.repeat(43)) });
    expect(bad.status).toBe(401);
    expect(await code(bad)).toBe('INVALID_REFRESH_TOKEN');
    expect(refreshCookie(bad)).toContain('Max-Age=0');
  });

  it('reuso do refresh antigo revoga a família e limpa o cookie', async () => {
    const { call, web } = await start();
    const first = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    const second = cookieValue(await call('POST', '/auth/refresh', { headers: web(first) }));
    const reuse = await call('POST', '/auth/refresh', { headers: web(first) });
    expect(reuse.status).toBe(401);
    expect(refreshCookie(reuse)).toContain('Max-Age=0');
    expect((await call('POST', '/auth/refresh', { headers: web(second) })).status).toBe(401);
  });

  it('corpo inválido no web (chave extra) é 400, não cai no cookie', async () => {
    const { call, web } = await start();
    const first = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    const res = await call('POST', '/auth/refresh', { headers: web(first), body: { x: 1 } });
    expect(res.status).toBe(400);
  });
});

describe('checagem de Origin (CSRF)', () => {
  it('web com Origin de fora: 403 CORS_FORBIDDEN em todas as rotas de auth do cookie', async () => {
    const { call, web, auth } = await start();
    const { pair } = await auth.createGuest();
    const cases: [string, string][] = [
      ['POST', '/auth/guest'],
      ['POST', '/auth/refresh'],
      ['POST', '/auth/google'],
      ['POST', '/auth/apple'],
      ['POST', '/auth/link'],
      ['POST', '/auth/logout'],
      ['DELETE', '/auth/account'],
    ];
    for (const [method, path] of cases) {
      const res = await call(method, path, {
        token: pair.accessToken,
        headers: web(pair.refreshToken, EVIL),
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(await code(res)).toBe('CORS_FORBIDDEN');
    }
    // nada foi consumido: o refresh ainda é vivo
    expect((await auth.refresh(pair.refreshToken)).accessToken).toBeDefined();
  });

  it('Origin nunca é "null" nem parecida com o host', async () => {
    const { call, web, self } = await start();
    for (const origin of ['null', `${self}.evil.test`, 'http://127.0.0.1:1', 'lixo']) {
      const res = await call('POST', '/auth/guest', { headers: web(undefined, origin) });
      expect(res.status, origin).toBe(403);
    }
  });

  it('aceita o próprio host e a origem de CORS_ORIGINS', async () => {
    const { call, web, self } = await start();
    expect((await call('POST', '/auth/guest', { headers: web(undefined, self) })).status).toBe(201);
    expect((await call('POST', '/auth/guest', { headers: web(undefined, ALLOWED) })).status).toBe(
      201,
    );
  });

  it('web com cookie e SEM Origin: 403; sem cookie e sem Origin passa (ferramenta, não navegador)', async () => {
    const { call, web, auth } = await start();
    const { pair } = await auth.createGuest();
    const withCookie = await call('POST', '/auth/refresh', {
      headers: web(pair.refreshToken, null),
    });
    expect(withCookie.status).toBe(403);
    expect((await call('POST', '/auth/guest', { headers: web(undefined, null) })).status).toBe(201);
  });

  it('nativo não é afetado por Origin', async () => {
    const { call } = await start();
    const res = await call('POST', '/auth/guest', { headers: { origin: EVIL } });
    expect(res.status).toBe(201);
  });
});

describe('logout e /auth/account pelo cookie', () => {
  it('logout web com corpo vazio revoga a família do cookie e limpa o cookie', async () => {
    const { call, web } = await start();
    const g = await call('POST', '/auth/guest', { headers: web() });
    const access = ((await g.json()) as { accessToken: string }).accessToken;
    const cookie = cookieValue(g);
    const out = await call('POST', '/auth/logout', { token: access, headers: web(cookie) });
    expect(out.status).toBe(204);
    expect(refreshCookie(out)).toContain('Max-Age=0');
    expect((await call('POST', '/auth/refresh', { headers: web(cookie) })).status).toBe(401);
    // o access vigente também morreu
    expect((await call('GET', '/me', { token: access })).status).toBe(401);
  });

  it('logout web sem cookie ainda é 204 e limpa; com { all: true } também limpa', async () => {
    const { call, web } = await start();
    const g = await call('POST', '/auth/guest', { headers: web() });
    const access = ((await g.json()) as { accessToken: string }).accessToken;
    const cookie = cookieValue(g);
    const all = await call('POST', '/auth/logout', {
      token: access,
      headers: web(cookie),
      body: { all: true },
    });
    expect(all.status).toBe(204);
    expect(refreshCookie(all)).toContain('Max-Age=0');
    expect((await call('POST', '/auth/refresh', { headers: web(cookie) })).status).toBe(401);
    const g2 = await call('POST', '/auth/guest', { headers: web() });
    const access2 = ((await g2.json()) as { accessToken: string }).accessToken;
    const none = await call('POST', '/auth/logout', { token: access2, headers: web() });
    expect(none.status).toBe(204);
    expect(refreshCookie(none)).toContain('Max-Age=0');
  });

  it('logout nativo com corpo vazio continua 400 (sem cookie)', async () => {
    const { call, auth } = await start();
    const { pair } = await auth.createGuest();
    const res = await call('POST', '/auth/logout', { token: pair.accessToken });
    expect(res.status).toBe(400);
  });

  it('DELETE /auth/account: o cookie é a prova de acesso recente; apaga a conta e limpa o cookie', async () => {
    const { call, web, repos } = await start();
    const g = await call('POST', '/auth/guest', { headers: web() });
    const body = (await g.json()) as { accessToken: string; user: { id: string } };
    const cookie = cookieValue(g);
    const res = await call('DELETE', '/auth/account', {
      token: body.accessToken,
      headers: web(cookie),
    });
    expect(res.status).toBe(204);
    expect(refreshCookie(res)).toContain('Max-Age=0');
    expect(await repos.users.findById(body.user.id)).toBeNull();
    expect((await call('POST', '/auth/refresh', { headers: web(cookie) })).status).toBe(401);
  });

  it('DELETE /auth/account sem cookie válido: 401 e a conta fica; exige o access', async () => {
    const { call, web, repos } = await start();
    const g = await call('POST', '/auth/guest', { headers: web() });
    const body = (await g.json()) as { accessToken: string; user: { id: string } };
    const noCookie = await call('DELETE', '/auth/account', {
      token: body.accessToken,
      headers: web(),
    });
    expect(noCookie.status).toBe(401);
    expect(await code(noCookie)).toBe('INVALID_REFRESH_TOKEN');
    expect(await repos.users.findById(body.user.id)).not.toBeNull();
    const noAccess = await call('DELETE', '/auth/account', { headers: web(cookieValue(g)) });
    expect(noAccess.status).toBe(401);
  });

  it('DELETE /auth/account com corpo { refreshToken } age como DELETE /me (nativo)', async () => {
    const { call, auth, repos } = await start();
    const { user, pair } = await auth.createGuest();
    const res = await call('DELETE', '/auth/account', {
      token: pair.accessToken,
      body: { refreshToken: pair.refreshToken },
    });
    expect(res.status).toBe(204);
    expect(await repos.users.findById(user.id)).toBeNull();
  });
});

describe('login social e vínculo no web', () => {
  it('login social web: cookie, sem refreshToken no corpo, created preservado', async () => {
    const { call, web, auth } = await start();
    const nonce = (await auth.issueNonce()).nonce;
    const res = await call('POST', '/auth/google', {
      headers: web(),
      body: { provider: 'google', idToken: 'test:web1', nonce },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body['created']).toBe(true);
    expect(body['refreshToken']).toBeUndefined();
    expect(refreshCookie(res)).toBeDefined();
    // o cookie sustenta a sessão
    expect((await call('POST', '/auth/refresh', { headers: web(cookieValue(res)) })).status).toBe(
      200,
    );
  });

  it('vínculo web troca o cookie (as sessões antigas morrem)', async () => {
    const { call, web } = await start();
    const g = await call('POST', '/auth/guest', { headers: web() });
    const access = ((await g.json()) as { accessToken: string }).accessToken;
    const old = cookieValue(g);
    const { nonce } = (await (await call('GET', '/auth/nonce')).json()) as { nonce: string };
    const res = await call('POST', '/auth/link', {
      token: access,
      headers: web(old),
      body: { provider: 'google', idToken: 'test:vw', nonce },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>)['refreshToken']).toBeUndefined();
    const fresh = cookieValue(res);
    expect(fresh).not.toBe(old);
    expect((await call('POST', '/auth/refresh', { headers: web(old) })).status).toBe(401);
    expect((await call('POST', '/auth/refresh', { headers: web(fresh) })).status).toBe(200);
  });
});

describe('login novo por cima de cookie antigo (web)', () => {
  it('guest e login social revogam a família do cookie anterior e o access dela', async () => {
    const { call, web, auth } = await start();
    const first = await call('POST', '/auth/guest', { headers: web() });
    const firstAccess = ((await first.json()) as { accessToken: string }).accessToken;
    const old = cookieValue(first);
    const second = await call('POST', '/auth/guest', { headers: web(old) });
    expect(second.status).toBe(201);
    expect(cookieValue(second)).not.toBe(old);
    expect((await call('POST', '/auth/refresh', { headers: web(old) })).status).toBe(401);
    expect((await call('GET', '/me', { token: firstAccess })).status).toBe(401);
    // a sessão nova segue viva
    expect(
      (await call('POST', '/auth/refresh', { headers: web(cookieValue(second)) })).status,
    ).toBe(200);
    // login social por cima de um cookie vivo
    const live = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    const { nonce } = await auth.issueNonce();
    const social = await call('POST', '/auth/google', {
      headers: web(live),
      body: { provider: 'google', idToken: 'test:troca', nonce },
    });
    expect(social.status).toBe(201);
    expect((await call('POST', '/auth/refresh', { headers: web(live) })).status).toBe(401);
  });

  it('refresh NÃO revoga o cookie que acabou de rotacionar (a família continua)', async () => {
    const { call, web } = await start();
    const c1 = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    const c2 = cookieValue(await call('POST', '/auth/refresh', { headers: web(c1) }));
    expect((await call('POST', '/auth/refresh', { headers: web(c2) })).status).toBe(200);
  });

  it('falha ao revogar (Redis fora) não derruba o login: 201, cookie novo e aviso no log', async () => {
    const { call, web, auth } = await start();
    const old = cookieValue(await call('POST', '/auth/guest', { headers: web() }));
    auth.revokeRefreshToken = () => Promise.reject(new TokenStoreUnavailableError());
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      const res = await call('POST', '/auth/guest', { headers: web(old) });
      expect(res.status).toBe(201);
      expect(refreshCookie(res)).toBeDefined();
    } finally {
      restore();
    }
    expect(lines.join('\n')).toContain('não revogou a sessão anterior');
    expect(lines.join('\n')).not.toContain(old);
  });

  it('sem cookie anterior ou no nativo, nada é revogado nem quebra', async () => {
    const { call, web } = await start();
    expect((await call('POST', '/auth/guest', { headers: web() })).status).toBe(201);
    expect((await call('POST', '/auth/guest')).status).toBe(201);
  });
});

describe('CORS com credenciais', () => {
  it('origem da lista: Allow-Credentials e X-Client liberados; fora da lista, nada', async () => {
    const { call } = await start();
    const ok = await call('OPTIONS', '/auth/refresh', {
      headers: {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'x-client, content-type',
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    expect(ok.headers.get('access-control-allow-credentials')).toBe('true');
    expect(ok.headers.get('access-control-allow-headers')).toContain('X-Client');
    const bad = await call('OPTIONS', '/auth/refresh', {
      headers: { origin: EVIL, 'access-control-request-method': 'POST' },
    });
    expect(bad.status).toBe(403);
    expect(bad.headers.get('access-control-allow-credentials')).toBeNull();
    const real = await call('GET', '/auth/nonce', { headers: { origin: EVIL } });
    expect(real.headers.get('access-control-allow-credentials')).toBeNull();
  });
});
