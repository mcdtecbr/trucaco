import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import { SIGNAL_IDS } from '@trucaco/protocol';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it } from 'vitest';
import { AuthService, hashRefresh } from '../auth/authService';
import { DEFAULT_LIMITS, type AuthConfig, type RestLimits } from '../auth/config';
import { MemoryTokenStore, TokenStoreUnavailableError, type TokenStore } from '../auth/tokenStore';
import { createMemoryRepositories } from '../db';
import type { UserRepository } from '../db/types';
import { setLogSink } from '../logger';
import { installBaseMiddleware, mountFallbacks, mountRest } from './rest';

const SECRET = new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!');
const CFG: AuthConfig = {
  secret: SECRET,
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};

interface Opts {
  limits?: Partial<RestLimits>;
  corsOrigins?: string[];
  trustProxy?: boolean;
  users?: UserRepository;
  cfg?: Partial<AuthConfig>;
  tokens?: TokenStore;
}

const running: HttpServer[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start(opts: Opts = {}) {
  const repos = createMemoryRepositories();
  const users = opts.users ?? repos.users;
  const auth = new AuthService(users, opts.tokens ?? new MemoryTokenStore(), {
    ...CFG,
    ...opts.cfg,
  });
  const app = express();
  installBaseMiddleware(app, { corsOrigins: opts.corsOrigins ?? [], hsts: false });
  mountRest(app, {
    auth,
    users,
    limits: { ...DEFAULT_LIMITS, perIpPerMin: 10_000, perUserPerMin: 10_000, ...opts.limits },
    corsOrigins: opts.corsOrigins ?? [],
    trustProxy: opts.trustProxy === true,
  });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (
    method: string,
    path: string,
    init: { body?: unknown; token?: string; headers?: Record<string, string>; raw?: string } = {},
  ): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        ...(init.body !== undefined || init.raw !== undefined
          ? { 'content-type': 'application/json' }
          : {}),
        ...(init.token !== undefined ? { authorization: `Bearer ${init.token}` } : {}),
        ...init.headers,
      },
      ...(init.raw !== undefined
        ? { body: init.raw }
        : init.body !== undefined
          ? { body: JSON.stringify(init.body) }
          : {}),
    });
  const guest = async () => {
    const res = await call('POST', '/auth/guest');
    return (await res.json()) as {
      user: { id: string; nickname: string };
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };
  };
  return { call, guest, repos, auth, base };
}

const code = async (res: Response): Promise<string | undefined> =>
  ((await res.json()) as { error?: { code?: string } }).error?.code;

describe('POST /auth/guest', () => {
  it('cria convidado e devolve par de tokens; cabeçalhos de segurança presentes', async () => {
    const { call, repos } = await start();
    const res = await call('POST', '/auth/guest');
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      user: { nickname: string };
      expiresIn: number;
      refreshToken: string;
    };
    expect(body.user.nickname).toMatch(/^Visitante\d+$/);
    expect(body.expiresIn).toBe(900);
    expect(body.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repos.store.users.size).toBe(1);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('corpo não-JSON é 415; corpo acima do limite é 413; JSON malformado é 400', async () => {
    const { call } = await start();
    const bad = await call('POST', '/auth/guest', {
      raw: 'x=1',
      headers: { 'content-type': 'text/plain' },
    });
    expect(bad.status).toBe(415);
    expect(await code(bad)).toBe('UNSUPPORTED_MEDIA_TYPE');
    const big = await call('POST', '/auth/refresh', {
      raw: JSON.stringify({ refreshToken: 'a'.repeat(9000) }),
    });
    expect(big.status).toBe(413);
    expect(await code(big)).toBe('PAYLOAD_TOO_LARGE');
    const malformed = await call('POST', '/auth/refresh', { raw: '{"refreshToken": ' });
    expect(malformed.status).toBe(400);
    expect(await code(malformed)).toBe('INVALID_JSON');
    const prim = await call('POST', '/auth/refresh', { raw: '"x"' });
    expect(prim.status).toBe(400);
  });
});

describe('POST /auth/refresh', () => {
  it('rotaciona; o token antigo reapresentado derruba a família (reuso)', async () => {
    const { call, guest } = await start({ cfg: { refreshReuseGraceSec: 0 } });
    const g = await guest();
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
    expect(r1.status).toBe(200);
    const p1 = (await r1.json()) as { accessToken: string; refreshToken: string };
    expect(p1.refreshToken).not.toBe(g.refreshToken);
    expect((await call('GET', '/me', { token: p1.accessToken })).status).toBe(200);

    const reuse = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
    expect(reuse.status).toBe(401);
    expect(await code(reuse)).toBe('INVALID_REFRESH_TOKEN');
    // a família inteira morreu: o token legítimo novo não serve mais, nem o access vigente
    const dead = await call('POST', '/auth/refresh', { body: { refreshToken: p1.refreshToken } });
    expect(dead.status).toBe(401);
    expect((await call('GET', '/me', { token: p1.accessToken })).status).toBe(401);
  });

  it('graça: reapresentar o token recém-rotacionado devolve par novo (200), uma única vez', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
    const r2 = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
    expect([r1.status, r2.status]).toEqual([200, 200]);
    const p2 = (await r2.json()) as { refreshToken: string };
    expect(p2.refreshToken).not.toBe(g.refreshToken);
    const r3 = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
    expect(r3.status).toBe(401);
    expect(await code(r3)).toBe('INVALID_REFRESH_TOKEN');
  });

  it('Redis fora do ar: 503 SERVICE_UNAVAILABLE (não 401 nem 500), sem vazar a causa', async () => {
    const { guest } = await start();
    const g = await guest();
    const down = new Proxy(new MemoryTokenStore(), {
      get: (_t, prop) =>
        prop === 'close'
          ? async () => undefined
          : async () => {
              throw new TokenStoreUnavailableError();
            },
    }) as unknown as TokenStore;
    const s = await start({ tokens: down });
    const refresh = await s.call('POST', '/auth/refresh', {
      body: { refreshToken: g.refreshToken },
    });
    expect(refresh.status).toBe(503);
    expect(await code(refresh)).toBe('SERVICE_UNAVAILABLE');
    const me = await s.call('GET', '/me', { token: g.accessToken });
    expect(me.status).toBe(503);
  });

  it('dois refresh simultâneos com o mesmo token: só um vence', async () => {
    const { call, guest } = await start({ cfg: { refreshReuseGraceSec: 0 } });
    const g = await guest();
    const rs = await Promise.all(
      Array.from({ length: 6 }, () =>
        call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } }),
      ),
    );
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 401)).toHaveLength(5);
  });

  it('valida o corpo: sem campo, campo extra, tipo errado e token desconhecido', async () => {
    const { call } = await start();
    for (const body of [{}, { refreshToken: 5 }, { refreshToken: 'x', extra: 1 }, [], null]) {
      const res = await call('POST', '/auth/refresh', { body });
      expect([400]).toContain(res.status);
    }
    const sem = await call('POST', '/auth/refresh');
    expect(sem.status).toBe(400);
    const unknown = await call('POST', '/auth/refresh', { body: { refreshToken: 'A'.repeat(43) } });
    expect(unknown.status).toBe(401);
    expect(await code(unknown)).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('autenticação das rotas /me', () => {
  it('sem token, token inválido, expirado, aud errado, na query e Basic: 401', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const noAuth = await call('GET', '/me');
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('www-authenticate')).toContain('Bearer');
    expect(await code(noAuth)).toBe('UNAUTHORIZED');
    expect((await call('GET', '/me', { token: 'lixo' })).status).toBe(401);
    // JWT só na query string nunca autentica
    expect((await call('GET', `/me?access_token=${g.accessToken}`)).status).toBe(401);
    expect((await call('GET', `/me?token=${g.accessToken}`)).status).toBe(401);
    expect(
      (await call('GET', '/me', { headers: { authorization: `Basic ${g.accessToken}` } })).status,
    ).toBe(401);
    const now = Math.floor(Date.now() / 1000);
    const mk = (extra: { aud?: string; exp?: number }) =>
      new SignJWT({ sub: g.user.id, jti: randomUUID() })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('trucaco')
        .setAudience(extra.aud ?? 'trucaco-api')
        .setIssuedAt(now - 3600)
        .setExpirationTime(extra.exp ?? now + 600)
        .sign(SECRET);
    expect((await call('GET', '/me', { token: await mk({ exp: now - 600 }) })).status).toBe(401);
    expect((await call('GET', '/me', { token: await mk({ aud: 'outro' }) })).status).toBe(401);
    expect((await call('GET', '/me', { token: await mk({}) })).status).toBe(200);
  });

  it('usuário removido: o access ainda assinado deixa de valer', async () => {
    const { call, guest, repos } = await start();
    const g = await guest();
    repos.store.users.delete(g.user.id);
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
  });
});

describe('GET/PUT /me', () => {
  it('lê o perfil sem campos internos', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const body = (await (await call('GET', '/me', { token: g.accessToken })).json()) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      id: g.user.id,
      nickname: g.user.nickname,
      provider: 'guest',
      avatar: null,
    });
    expect(body).not.toHaveProperty('providerSubject');
  });

  it('troca o apelido (NFC, validação) e devolve 409 sem vazar quando já existe', async () => {
    const { call, guest } = await start();
    const a = await guest();
    const b = await guest();
    const ok = await call('PUT', '/me', { token: a.accessToken, body: { nickname: 'Zé.Silva' } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ nickname: 'Zé.Silva' });
    expect(
      ((await (await call('GET', '/me', { token: a.accessToken })).json()) as { nickname: string })
        .nickname,
    ).toBe('Zé.Silva');

    const taken = await call('PUT', '/me', {
      token: b.accessToken,
      body: { nickname: 'zé.silva' },
    });
    expect(taken.status).toBe(409);
    const text = await taken.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'NICKNAME_TAKEN' } });
    expect(text).not.toContain(a.user.id);

    for (const nickname of [
      'ab',
      'a'.repeat(17),
      'com espaço',
      'emoji😀',
      'zero​width',
      '<script>',
    ]) {
      const res = await call('PUT', '/me', { token: b.accessToken, body: { nickname } });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('INVALID_NICKNAME');
    }
    for (const body of [{}, { nickname: 5 }, { nickname: 'abcd', role: 'admin' }]) {
      expect((await call('PUT', '/me', { token: b.accessToken, body })).status).toBe(400);
    }
    expect(
      (
        await call('PUT', '/me', {
          token: b.accessToken,
          raw: 'nope',
          headers: { 'content-type': 'text/plain' },
        })
      ).status,
    ).toBe(415);
  });

  it('PUT /me/avatar valida e limita', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const ok = await call('PUT', '/me/avatar', {
      token: g.accessToken,
      body: { parts: { hat: 'cap', skin: 3, glasses: false } },
    });
    expect(ok.status).toBe(200);
    const me = (await (await call('GET', '/me', { token: g.accessToken })).json()) as {
      avatar: unknown;
    };
    expect(me.avatar).toEqual({ hat: 'cap', skin: 3, glasses: false });
    const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, 1]));
    for (const parts of [many, { nested: { a: 1 } }, { long: 'x'.repeat(200) }]) {
      const res = await call('PUT', '/me/avatar', { token: g.accessToken, body: { parts } });
      expect(res.status).toBe(400);
      expect(await code(res)).toBe('INVALID_AVATAR');
    }
    for (const body of [{ parts: 'x' }, { parts: [] }, {}, { parts: {}, extra: 1 }]) {
      expect((await call('PUT', '/me/avatar', { token: g.accessToken, body })).status).toBe(400);
    }
  });

  it('códigos do parceiro: id inválido 400, sem vínculo 403, leitura vazia', async () => {
    const { call, guest, repos } = await start();
    const a = await guest();
    const b = await guest();
    const path = `/me/partners/${b.user.id}/codes`;
    const get = await call('GET', path, { token: a.accessToken });
    expect(get.status).toBe(200);
    expect(await get.json()).toEqual({ codes: {} });
    const denied = await call('PUT', path, {
      token: a.accessToken,
      body: { codes: { [SIGNAL_IDS[0] as string]: 'tenho zap' } },
    });
    expect(denied.status).toBe(403);
    expect(await code(denied)).toBe('NOT_PARTNERS');
    // depois de uma partida finalizada na mesma dupla, grava e lê (os dois lados)
    const now = new Date();
    await repos.matches.saveMatch({
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'public',
      roomCode: null,
      seed: 1,
      options: {},
      events: [],
      deals: null,
      winnerTeam: 0,
      games: [],
      status: 'finished',
      startedAt: now,
      endedAt: now,
      players: [
        { seat: 0, userId: a.user.id, team: 0, botFrom: null },
        { seat: 2, userId: b.user.id, team: 0, botFrom: null },
      ],
    });
    const codes = { [SIGNAL_IDS[0] as string]: 'tenho zap' };
    expect((await call('PUT', path, { token: a.accessToken, body: { codes } })).status).toBe(200);
    expect(
      await (await call('GET', `/me/partners/${a.user.id}/codes`, { token: b.accessToken })).json(),
    ).toEqual({ codes });
    expect(
      (await call('GET', '/me/partners/nao-uuid/codes', { token: a.accessToken })).status,
    ).toBe(400);
    expect((await call('PUT', path, { token: a.accessToken, body: { codes: 'x' } })).status).toBe(
      400,
    );
  });
});

describe('POST /auth/logout', () => {
  const refreshStatus = async (
    call: Awaited<ReturnType<typeof start>>['call'],
    refreshToken: string,
  ): Promise<number> => (await call('POST', '/auth/refresh', { body: { refreshToken } })).status;

  it('com refreshToken: 204 sem corpo, família morre e o access vigente é revogado', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const res = await call('POST', '/auth/logout', {
      token: g.accessToken,
      body: { refreshToken: g.refreshToken },
    });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(await refreshStatus(call, g.refreshToken)).toBe(401);
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
  });

  it('é idempotente: repetir (já com access revogado) dá 401 e nada quebra; com novo access, 204', async () => {
    const { call, guest, auth } = await start();
    const g = await guest();
    const body = { refreshToken: g.refreshToken };
    expect((await call('POST', '/auth/logout', { token: g.accessToken, body })).status).toBe(204);
    expect((await call('POST', '/auth/logout', { token: g.accessToken, body })).status).toBe(401);
    // chamada direta do serviço (outra sessão do mesmo usuário) repetida: sempre sem erro
    const principal = { userId: g.user.id, jti: 'qualquer-jti' };
    await auth.logout(principal, body);
    await auth.logout(principal, body);
  });

  it('refresh de OUTRO usuário: mesmo 204, mas a família dele NÃO é revogada (mutação: A não derruba B)', async () => {
    const { call, guest } = await start();
    const a = await guest();
    const b = await guest();
    const res = await call('POST', '/auth/logout', {
      token: a.accessToken,
      body: { refreshToken: b.refreshToken },
    });
    expect(res.status).toBe(204);
    expect(await refreshStatus(call, b.refreshToken)).toBe(200);
    // e o access de B continua válido
    expect((await call('GET', '/me', { token: b.accessToken })).status).toBe(200);
    // o access de A foi revogado mesmo assim (é o logout dele)
    expect((await call('GET', '/me', { token: a.accessToken })).status).toBe(401);
  });

  it('refresh inválido, malformado ou desconhecido: 204 igual (sem oráculo)', async () => {
    const { call, guest } = await start();
    for (const rt of ['lixo', 'A'.repeat(43), '', 'x'.repeat(5000)]) {
      const g = await guest();
      const res = await call('POST', '/auth/logout', {
        token: g.accessToken,
        body: { refreshToken: rt },
      });
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
    }
  });

  it('{ all: true } revoga todas as famílias do usuário e preserva as de outros', async () => {
    const { call, guest, auth } = await start();
    const a = await guest();
    const other = await guest();
    // segunda família de A: o servidor só cria família em guest, então simula via serviço
    const a2 = await auth.refresh(a.refreshToken); // continua na mesma família; basta para provar
    const res = await call('POST', '/auth/logout', { token: a2.accessToken, body: { all: true } });
    expect(res.status).toBe(204);
    expect(await refreshStatus(call, a.refreshToken)).toBe(401);
    expect(await refreshStatus(call, a2.refreshToken)).toBe(401);
    expect(await refreshStatus(call, other.refreshToken)).toBe(200);
  });

  it('{ all: true } invalida na hora o access vigente de OUTRO aparelho (/me 401), não só o apresentado', async () => {
    const tokens = new MemoryTokenStore();
    const { call, guest, auth } = await start({ tokens });
    const g = await guest();
    const refreshToken = randomBytes(32).toString('base64url');
    const access = await auth.jwt.sign(g.user.id);
    await tokens.createFamily({
      familyId: randomUUID(),
      userId: g.user.id,
      refreshHash: hashRefresh(refreshToken),
      jti: access.jti,
      ttlSec: 3600,
    });
    expect((await call('GET', '/me', { token: access.token })).status).toBe(200);
    const res = await call('POST', '/auth/logout', { token: g.accessToken, body: { all: true } });
    expect(res.status).toBe(204);
    expect((await call('GET', '/me', { token: access.token })).status).toBe(401);
    expect((await call('GET', '/me', { token: g.accessToken })).status).toBe(401);
    expect(await refreshStatus(call, refreshToken)).toBe(401);
  });

  it('corpo inválido: ausente, vazio, chaves extras, tipos errados, all diferente de true -> 400', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const bad: unknown[] = [
      undefined,
      {},
      [],
      { refreshToken: 1 },
      { all: false },
      { all: 'true' },
      { all: 1 },
      { all: true, refreshToken: g.refreshToken },
      { refreshToken: g.refreshToken, extra: 1 },
      { other: 'x' },
    ];
    for (const body of bad) {
      const res = await call('POST', '/auth/logout', {
        token: g.accessToken,
        ...(body === undefined ? {} : { body }),
      });
      expect([body, res.status]).toEqual([body, 400]);
      expect(await code(res)).toBe('INVALID_BODY');
    }
    // nada disso revogou a sessão
    expect(await refreshStatus(call, g.refreshToken)).toBe(200);
    expect((await call('POST', '/auth/logout', { token: g.accessToken, raw: '{' })).status).toBe(
      400,
    );
  });

  it('exige access válido (401), Content-Type JSON (415) e método POST (405)', async () => {
    const { call, guest } = await start();
    const g = await guest();
    const body = { refreshToken: g.refreshToken };
    expect((await call('POST', '/auth/logout', { body })).status).toBe(401);
    expect((await call('POST', '/auth/logout', { token: 'lixo', body })).status).toBe(401);
    const text = await call('POST', '/auth/logout', {
      token: g.accessToken,
      headers: { 'content-type': 'text/plain' },
      raw: JSON.stringify(body),
    });
    expect(text.status).toBe(415);
    expect((await call('GET', '/auth/logout')).status).toBe(405);
    expect(await refreshStatus(call, g.refreshToken)).toBe(200);
  });

  it('rate limit por usuário: estourou -> 429', async () => {
    const { call, guest } = await start({ limits: { perUserPerMin: 2 } });
    const g = await guest();
    // corpo inválido (400) não revoga o access, então dá para esgotar o limite do usuário
    const results: number[] = [];
    for (let i = 0; i < 4; i++) {
      results.push((await call('POST', '/auth/logout', { token: g.accessToken, body: {} })).status);
    }
    expect(results).toEqual([400, 400, 429, 429]);
  });

  it('token store fora do ar: 503, nunca 204', async () => {
    const store = new MemoryTokenStore();
    const { call, guest } = await start({ tokens: store });
    const g = await guest();
    store.revokeJti = async () => {
      throw new TokenStoreUnavailableError();
    };
    const res = await call('POST', '/auth/logout', {
      token: g.accessToken,
      body: { refreshToken: g.refreshToken },
    });
    expect(res.status).toBe(503);
  });

  it('o refresh token e o JWT não vão para o log', async () => {
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      const { call, guest } = await start();
      const g = await guest();
      await call('POST', '/auth/logout', {
        token: g.accessToken,
        body: { refreshToken: g.refreshToken },
      });
      const text = lines.join('\n');
      expect(text).not.toContain(g.refreshToken);
      expect(text).not.toContain(g.accessToken);
    } finally {
      restore();
    }
  });
});

describe('stubs, 404 e 405', () => {
  it('Google, Apple e link respondem 501 (link exige auth)', async () => {
    const { call, guest } = await start();
    const g = await guest();
    for (const path of ['/auth/google', '/auth/apple']) {
      const res = await call('POST', path, { body: { idToken: 'x' } });
      expect(res.status).toBe(501);
      expect(await code(res)).toBe('NOT_IMPLEMENTED');
    }
    expect((await call('POST', '/auth/link', { body: {} })).status).toBe(401);
    expect((await call('POST', '/auth/link', { token: g.accessToken, body: {} })).status).toBe(501);
  });

  it('404 e 405 genéricos, sem eco da entrada nem stack', async () => {
    const { call } = await start();
    const nf = await call('GET', '/segredo<script>/../etc?x=1');
    expect(nf.status).toBe(404);
    const text = await nf.text();
    expect(JSON.parse(text)).toEqual({ error: { code: 'NOT_FOUND' } });
    expect(text).not.toMatch(/script|etc|at\s.*\(|\.ts/);
    for (const [method, path, allow] of [
      ['GET', '/auth/guest', 'POST'],
      ['DELETE', '/me', 'GET, PUT'],
      ['POST', '/me/avatar', 'PUT'],
      ['PUT', '/auth/refresh', 'POST'],
    ] as const) {
      const res = await call(method, path);
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe(allow);
      expect(await code(res)).toBe('METHOD_NOT_ALLOWED');
    }
  });

  it('erro interno vira 500 genérico, sem mensagem nem stack, e nada sensível no log', async () => {
    const { users: base } = createMemoryRepositories();
    const boom = Object.create(base) as UserRepository;
    boom.createGuest = () => Promise.reject(new Error('senha-do-banco postgres://u:p@h/db'));
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      const { call } = await start({ users: boom });
      const res = await call('POST', '/auth/guest');
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: { code: 'INTERNAL' } });
      expect(text).not.toContain('senha');
      expect(lines.join('\n')).not.toContain('senha');
    } finally {
      restore();
    }
  });
});

describe('CORS', () => {
  it('sem CORS_ORIGINS nenhuma origem é liberada; preflight recusado', async () => {
    const { call } = await start();
    const res = await call('GET', '/me', { headers: { origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await call('OPTIONS', '/auth/refresh', {
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('origem da lista recebe ACAO exato (nunca *) e preflight 204; outra origem não', async () => {
    const { call } = await start({ corsOrigins: ['https://app.trucaco.com'] });
    const ok = await call('GET', '/me', { headers: { origin: 'https://app.trucaco.com' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://app.trucaco.com');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    expect(ok.headers.get('vary')).toContain('Origin');
    const pre = await call('OPTIONS', '/auth/refresh', {
      headers: { origin: 'https://app.trucaco.com', 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('Authorization');
    const other = await call('GET', '/me', {
      headers: { origin: 'https://app.trucaco.com.evil.io' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('rate limit REST', () => {
  it('/auth/guest: limite por IP por hora responde 429 com Retry-After e formato estável', async () => {
    const { call } = await start({ limits: { guestPerIpPerHour: 3 } });
    for (let i = 0; i < 3; i++) expect((await call('POST', '/auth/guest')).status).toBe(201);
    const res = await call('POST', '/auth/guest');
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
    expect(await res.json()).toEqual({ error: { code: 'RATE_LIMITED' } });
  });

  it('/auth/guest: teto global vale para IPs diferentes (X-Forwarded-For, proxy confiável)', async () => {
    const { call } = await start({ limits: { guestGlobalPerHour: 2 }, trustProxy: true });
    expect(
      (await call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '1.1.1.1' } })).status,
    ).toBe(201);
    expect(
      (await call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '2.2.2.2' } })).status,
    ).toBe(201);
    expect(
      (await call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '3.3.3.3' } })).status,
    ).toBe(429);
  });

  it('TRUST_PROXY: desligado ignora X-Forwarded-For; ligado usa o ÚLTIMO item', async () => {
    const off = await start({ limits: { guestPerIpPerHour: 1 } });
    expect(
      (await off.call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '9.9.9.1' } })).status,
    ).toBe(201);
    expect(
      (await off.call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '9.9.9.2' } })).status,
    ).toBe(429);

    const on = await start({ limits: { guestPerIpPerHour: 1 }, trustProxy: true });
    // o item forjado pelo cliente (primeiro) varia; o do proxy (último) é o mesmo
    expect(
      (await on.call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '8.8.8.1, 7.7.7.7' } }))
        .status,
    ).toBe(201);
    expect(
      (await on.call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '8.8.8.2, 7.7.7.7' } }))
        .status,
    ).toBe(429);
    expect(
      (await on.call('POST', '/auth/guest', { headers: { 'x-forwarded-for': '8.8.8.2, 7.7.7.8' } }))
        .status,
    ).toBe(201);
  });

  it('/auth/refresh: limite por IP; rotas autenticadas: limite por usuário e por IP', async () => {
    const r = await start({ limits: { refreshPerIpPerMin: 2 } });
    const g = await r.guest();
    expect(
      (await r.call('POST', '/auth/refresh', { body: { refreshToken: 'A'.repeat(43) } })).status,
    ).toBe(401);
    expect(
      (await r.call('POST', '/auth/refresh', { body: { refreshToken: 'A'.repeat(43) } })).status,
    ).toBe(401);
    expect(
      (await r.call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } })).status,
    ).toBe(429);

    const u = await start({ limits: { perUserPerMin: 3 } });
    const a = await u.guest();
    const b = await u.guest();
    for (let i = 0; i < 3; i++)
      expect((await u.call('GET', '/me', { token: a.accessToken })).status).toBe(200);
    expect((await u.call('GET', '/me', { token: a.accessToken })).status).toBe(429);
    // outro usuário não é afetado
    expect((await u.call('GET', '/me', { token: b.accessToken })).status).toBe(200);

    const ip = await start({ limits: { perIpPerMin: 4 } });
    const c = await ip.guest();
    for (let i = 0; i < 3; i++)
      expect((await ip.call('GET', '/me', { token: c.accessToken })).status).toBe(200);
    expect((await ip.call('GET', '/me', { token: c.accessToken })).status).toBe(429);
  });

  it('escritas do perfil têm limite próprio mais baixo', async () => {
    const { call, guest } = await start({ limits: { perUserPerMin: 60 } });
    const g = await guest();
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await call('PUT', '/me', { token: g.accessToken, body: { nickname: `Nome${i}x` } }))
        .status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('logs', () => {
  it('nenhum token, hash nem corpo de /auth aparece nos logs', async () => {
    const lines: string[] = [];
    const restore = setLogSink((_l, msg, f) => lines.push(JSON.stringify({ msg, ...f })));
    try {
      const { call, guest } = await start();
      const g = await guest();
      const r = await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } });
      const p = (await r.json()) as { accessToken: string; refreshToken: string };
      await call('POST', '/auth/refresh', { body: { refreshToken: g.refreshToken } }); // reuso
      await call('GET', '/me', { token: 'lixo.lixo.lixo' });
      const all = lines.join('\n');
      for (const secret of [g.accessToken, g.refreshToken, p.accessToken, p.refreshToken]) {
        expect(all).not.toContain(secret);
      }
    } finally {
      restore();
    }
  });
});
