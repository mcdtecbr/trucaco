import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';
import type { ApiAuth } from './api';
import { fakeFetch, tick } from './testHelpers';
import type { Handler } from './testHelpers';

function makeAuth(initial: { access: string | null; refresh: string | null }) {
  const st = { ...initial, saved: [] as string[], rejected: 0, events: [] as string[] };
  const auth: ApiAuth = {
    getAccessToken: () => st.access,
    getRefreshToken: () => st.refresh,
    async setTokens(pair) {
      await tick(1);
      st.access = pair.accessToken;
      st.refresh = pair.refreshToken;
      st.saved.push(pair.refreshToken);
      st.events.push('saved');
    },
    onRefreshRejected() {
      st.rejected += 1;
      st.access = null;
      st.refresh = null;
    },
  };
  return { st, auth };
}

const pair = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, expiresIn: 900 });

function api(handler: Handler, auth: ApiAuth, extra: { timeoutMs?: number } = {}) {
  const f = fakeFetch(handler);
  const client = createApiClient({ baseUrl: 'http://x/', fetch: f.fetch, auth, ...extra });
  return { client, ...f };
}

describe('mapeamento de erros', () => {
  it('lê o código do corpo e o Retry-After', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(
      () => ({
        status: 429,
        json: { error: { code: 'RATE_LIMITED' } },
        headers: { 'retry-after': '12' },
      }),
      auth,
    );
    const e = await client.queueStatus().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({
      status: 429,
      code: 'RATE_LIMITED',
      kind: 'http',
      retryAfterSeconds: 12,
    });
    expect((e as ApiError).isUnavailable).toBe(false);
  });

  it('código desconhecido vira UNKNOWN; corpo inválido não quebra', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const a = api(() => ({ status: 418, json: { error: { code: 'XYZ' } } }), auth);
    await expect(a.client.me()).rejects.toMatchObject({ code: 'UNKNOWN', status: 418 });
    const b = api(() => ({ status: 400, text: '<html>' }), auth);
    await expect(b.client.me()).rejects.toMatchObject({ code: 'UNKNOWN' });
  });

  it('503 sem corpo é indisponível (SERVICE_UNAVAILABLE)', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(() => ({ status: 503 }), auth);
    const e = (await client.me().catch((x: unknown) => x)) as ApiError;
    expect(e).toMatchObject({ code: 'SERVICE_UNAVAILABLE', kind: 'unavailable' });
    expect(e.isUnavailable).toBe(true);
  });

  it('falha de rede e timeout são indisponíveis, sem vazar mensagem original', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const a = api(() => 'throw', auth);
    const e = (await a.client.me().catch((x: unknown) => x)) as ApiError;
    expect(e).toMatchObject({ kind: 'network', code: 'NETWORK', status: 0 });
    expect(e.message).not.toContain('fetch failed');
    expect(e.isUnavailable).toBe(true);
    const b = api(() => 'hang', auth, { timeoutMs: 20 });
    const t = (await b.client.me().catch((x: unknown) => x)) as ApiError;
    expect(t).toMatchObject({ kind: 'timeout', code: 'TIMEOUT' });
    expect(t.isUnavailable).toBe(true);
  });

  it('2xx sem corpo JSON é resposta inválida; 204 é vazio', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const a = api(() => ({ status: 200, text: 'oops' }), auth);
    await expect(a.client.me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const b = api(() => ({ status: 204 }), auth);
    await expect(b.client.logout({ all: true })).resolves.toBeUndefined();
  });

  it('guest valida a forma da resposta', async () => {
    const { auth } = makeAuth({ access: null, refresh: null });
    const bad = api(() => ({ status: 201, json: pair(1) }), auth);
    await expect(bad.client.guest()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    const ok = api(
      () => ({ status: 201, json: { ...pair(1), user: { id: 'u', nickname: 'n' } } }),
      auth,
    );
    await expect(ok.client.guest()).resolves.toMatchObject({ user: { id: 'u' } });
  });
});

describe('requisições', () => {
  it('envia Bearer, JSON e credentials omit; rotas e corpos corretos', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client, calls } = api(() => ({ status: 200, json: {} }), auth);
    await client.joinTable('ABCDEFGH');
    await client.updateAvatar({ hat: 1 });
    await client.updateNickname('Zé');
    await client.leaveQueue();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /tables/join',
      'PUT /me/avatar',
      'PUT /me',
      'POST /queue/leave',
    ]);
    expect(calls[0]?.headers['authorization']).toBe('Bearer a0');
    expect(calls[0]?.body).toEqual({ code: 'ABCDEFGH' });
    expect(calls[1]?.body).toEqual({ parts: { hat: 1 } });
    expect(calls[3]?.headers['content-type']).toBeUndefined();
  });

  it('sem access token renova antes de chamar', async () => {
    const { auth, st } = makeAuth({ access: null, refresh: 'r0' });
    const { client, calls } = api(
      (r) =>
        r.path === '/auth/refresh' ? { status: 200, json: pair(1) } : { status: 200, json: {} },
      auth,
    );
    await client.me();
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh', '/me']);
    expect(st.access).toBe('a1');
  });
});

describe('rotas da Fase 6 (histórico, bloqueio, denúncia, apagar conta)', () => {
  it('matches pagina por query; blocks/block/unblock/report usam rota, método e corpo certos', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client, calls } = api((r) => {
      if (r.path === '/matches') return { status: 200, json: { items: [], nextCursor: null } };
      if (r.path === '/me/blocks' && r.method === 'GET')
        return { status: 200, json: { blocks: [] } };
      if (r.path === '/reports') return { status: 201, json: {} };
      return { status: 204 };
    }, auth);
    await client.matches();
    await client.matches('c/1', 10);
    await client.blocks();
    await client.block('u1');
    await client.unblock('u 2');
    await client.report({ userId: 'u1', reason: 'cheating' });
    expect(calls.map((c) => `${c.method} ${c.path}${c.search}`)).toEqual([
      'GET /matches',
      'GET /matches?limit=10&cursor=c%2F1',
      'GET /me/blocks',
      'POST /me/blocks',
      'DELETE /me/blocks/u%202',
      'POST /reports',
    ]);
    expect(calls[3]?.body).toEqual({ userId: 'u1' });
    expect(calls[5]?.body).toEqual({ userId: 'u1', reason: 'cheating' });
  });

  it('deleteAccount manda o refresh e NÃO repete por 401', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client, calls } = api(
      () => ({ status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }),
      auth,
    );
    await expect(client.deleteAccount('r0')).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'DELETE', path: '/me', body: { refreshToken: 'r0' } });
    expect(st.saved).toEqual([]);
  });

  it('erros 400/404/429 chegam com o código do servidor', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(
      () => ({
        status: 429,
        json: { error: { code: 'RATE_LIMITED' } },
        headers: { 'retry-after': '3600' },
      }),
      auth,
    );
    await expect(client.report({ userId: 'u', reason: 'other' })).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryAfterSeconds: 3600,
    });
  });
});

describe('refresh em fila única', () => {
  it('N chamadas concorrentes com 401 geram UM refresh e cada uma repete uma vez', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    let refreshCalls = 0;
    const { client, calls } = api(async (r) => {
      if (r.path === '/auth/refresh') {
        refreshCalls += 1;
        await tick(10);
        return { status: 200, json: pair(1) };
      }
      return r.headers['authorization'] === 'Bearer a0'
        ? { status: 401, json: { error: { code: 'UNAUTHORIZED' } } }
        : { status: 200, json: { id: 'u' } };
    }, auth);
    const out = await Promise.all([
      client.me(),
      client.me(),
      client.queueStatus(),
      client.leaveQueue(),
    ]);
    expect(out).toHaveLength(4);
    expect(refreshCalls).toBe(1);
    expect(st.saved).toEqual(['r1']);
    expect(calls.filter((c) => c.path !== '/auth/refresh')).toHaveLength(8);
  });

  it('chamada que recebe 401 depois do refresh alheio reaproveita o token novo (sem 2o refresh)', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    let refreshCalls = 0;
    const { client } = api(async (r) => {
      if (r.path === '/auth/refresh') {
        refreshCalls += 1;
        return { status: 200, json: pair(1) };
      }
      if (r.path === '/slow') return { status: 200, json: {} };
      if (r.path === '/queue' && r.headers['authorization'] === 'Bearer a0') {
        // chega tarde: o refresh de /me já terminou
        await tick(30);
        return { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
      }
      return r.headers['authorization'] === 'Bearer a0'
        ? { status: 401, json: {} }
        : { status: 200, json: {} };
    }, auth);
    await Promise.all([client.me(), client.queueStatus()]);
    expect(refreshCalls).toBe(1);
    expect(st.access).toBe('a1');
  });

  it('token novo é persistido ANTES de repetir a requisição', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api((r) => {
      if (r.path === '/auth/refresh') return { status: 200, json: pair(1) };
      st.events.push(`req:${r.headers['authorization'] ?? ''}`);
      return r.headers['authorization'] === 'Bearer a0'
        ? { status: 401, json: {} }
        : { status: 200, json: {} };
    }, auth);
    await client.me();
    expect(st.events).toEqual(['req:Bearer a0', 'saved', 'req:Bearer a1']);
  });

  it('401 repetido não entra em laço: repete uma vez e propaga', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    let refreshCalls = 0;
    const { client, calls } = api((r) => {
      if (r.path === '/auth/refresh') {
        refreshCalls += 1;
        return { status: 200, json: pair(refreshCalls) };
      }
      return { status: 401, json: { error: { code: 'UNAUTHORIZED' } } };
    }, auth);
    await expect(client.me()).rejects.toMatchObject({ status: 401 });
    expect(refreshCalls).toBe(1);
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(2);
  });

  it('refresh recusado (401) encerra a sessão uma vez e propaga', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(
      (r) =>
        r.path === '/auth/refresh'
          ? { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }
          : { status: 401, json: {} },
      auth,
    );
    const res = await Promise.allSettled([client.me(), client.me()]);
    expect(res.every((x) => x.status === 'rejected')).toBe(true);
    expect(st.rejected).toBe(1);
  });

  it.each([
    ['503', { status: 503 }],
    ['rede', 'throw' as const],
  ])('refresh com %s NÃO descarta a sessão e permite nova tentativa', async (_n, bad) => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    let failing = true;
    const { client } = api((r) => {
      if (r.path === '/auth/refresh') return failing ? bad : { status: 200, json: pair(1) };
      return r.headers['authorization'] === 'Bearer a0'
        ? { status: 401, json: {} }
        : { status: 200, json: {} };
    }, auth);
    const e = (await client.me().catch((x: unknown) => x)) as ApiError;
    expect(e.isUnavailable).toBe(true);
    expect(st.rejected).toBe(0);
    expect(st.refresh).toBe('r0');
    failing = false;
    await expect(client.me()).resolves.toBeDefined();
    expect(st.refresh).toBe('r1');
  });

  it('refresh de resposta inválida não grava nada', async () => {
    const { auth, st } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(
      (r) =>
        r.path === '/auth/refresh'
          ? { status: 200, json: { accessToken: 'x' } }
          : { status: 401, json: {} },
      auth,
    );
    await expect(client.me()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(st.saved).toEqual([]);
  });

  it('sem refresh token: 401 local, sem chamar a rede', async () => {
    const { auth } = makeAuth({ access: null, refresh: null });
    const { client, calls } = api(() => ({ status: 200, json: {} }), auth);
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(calls).toHaveLength(0);
  });

  it('logout não tenta refresh no 401', async () => {
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client, calls } = api(() => ({ status: 401, json: {} }), auth);
    await expect(client.logout({ refreshToken: 'r0' })).rejects.toMatchObject({ status: 401 });
    expect(calls.map((c) => c.path)).toEqual(['/auth/logout']);
  });
});

describe('segurança', () => {
  it('nunca escreve no console, nem em erro', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const { auth } = makeAuth({ access: 'a0', refresh: 'r0' });
    const { client } = api(
      (r) => (r.path === '/auth/refresh' ? { status: 503 } : { status: 401, json: {} }),
      auth,
    );
    await client.me().catch(() => undefined);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('a mensagem do erro não contém token', async () => {
    const { auth } = makeAuth({ access: 'SEGREDO-A', refresh: 'SEGREDO-R' });
    const { client } = api(() => ({ status: 401, json: {} }), auth);
    const e = (await client.me().catch((x: unknown) => x)) as Error;
    expect(e.message).not.toContain('SEGREDO');
  });
});
