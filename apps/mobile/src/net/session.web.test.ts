/**
 * Sessão e cliente HTTP no modo web (Fase 7A): refresh em cookie httpOnly. O fetch é roteirizado; o "cookie"
 * não existe aqui (quem o guarda é o navegador), então o que se confere é o que o cliente ENVIA e GUARDA.
 */
import { describe, expect, it } from 'vitest';
import { createApiClient, isApiError } from './api';
import { createSession } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { StoredSession } from './tokenStorageCore';
import { fakeFetch } from './testHelpers';
import type { FakeReply, Handler, RecordedRequest } from './testHelpers';

/** Resposta de web: sem `refreshToken` (vai em `Set-Cookie`). */
const web = (n: number) => ({ accessToken: `a${n}`, expiresIn: 900 });
const me = { id: 'u1', nickname: 'Zé', provider: 'guest' };
const hint: StoredSession = { userId: 'u1', nickname: 'Zé' };

function routes(over: Handler = () => ({ status: 404 })): Handler {
  return (r: RecordedRequest): FakeReply | Promise<FakeReply> | 'throw' | 'hang' => {
    if (r.path === '/auth/refresh') return { status: 200, json: web(2) };
    if (r.path === '/me' && r.method === 'GET') return { status: 200, json: me };
    if (r.path === '/auth/guest') {
      return { status: 201, json: { ...web(1), user: { id: 'g1', nickname: 'Convidado' } } };
    }
    if (r.path === '/auth/logout') return { status: 204 };
    return over(r);
  };
}

function make(
  handler: Handler,
  storage = createMemoryTokenStorage(),
  extra: { crossOrigin?: boolean } = {},
) {
  const f = fakeFetch(handler);
  const session = createSession({
    storage,
    baseUrl: 'http://srv',
    fetch: f.fetch,
    webSession: true,
    ...extra,
  });
  return { session, storage, ...f };
}

describe('web: restauração por cookie', () => {
  it('sem nada guardado: refresh com corpo vazio e X-Client; usuário vem de /me; grava só o usuário', async () => {
    const { session, storage, calls } = make(routes());
    expect((await session.start()).status).toBe('authenticated');
    const refresh = calls.find((c) => c.path === '/auth/refresh');
    expect(refresh?.body).toBeUndefined();
    expect(refresh?.headers['x-client']).toBe('web');
    expect(calls.find((c) => c.path === '/me')?.headers['authorization']).toBe('Bearer a2');
    expect(calls.find((c) => c.path === '/me')?.headers['x-client']).toBeUndefined();
    expect(session.getState().user).toEqual({ id: 'u1', nickname: 'Zé', provider: 'guest' });
    expect(await storage.load()).toEqual({ userId: 'u1', nickname: 'Zé' });
    expect(session.getAccessToken()).toBe('a2');
  });

  it('cookie ausente ou recusado (401): cria convidado, sem refresh no corpo nem no armazenamento', async () => {
    const f = routes();
    const w = make((r) =>
      r.path === '/auth/refresh'
        ? { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }
        : f(r),
    );
    expect((await w.session.start()).status).toBe('authenticated');
    expect(w.calls.map((c) => c.path)).toEqual(['/auth/refresh', '/auth/guest']);
    expect(w.calls[1]?.headers['x-client']).toBe('web');
    expect(w.session.getState().user).toMatchObject({ id: 'g1', provider: 'guest' });
    const saved = await w.storage.load();
    expect(saved).toEqual({ userId: 'g1', nickname: 'Convidado' });
    expect(JSON.stringify(saved)).not.toContain('refresh');
  });

  it('rede fora no boot: unavailable, e start() tenta de novo', async () => {
    let down = true;
    const { session } = make((r) => (down ? 'throw' : routes()(r)), createMemoryTokenStorage(hint));
    expect((await session.start()).status).toBe('unavailable');
    expect(session.getState().user).toEqual({ id: 'u1', nickname: 'Zé' });
    down = false;
    expect((await session.start()).status).toBe('authenticated');
  });

  it('/me falha sem 401 mas há dica guardada: usa a dica', async () => {
    const h = routes();
    const w = make(
      (r) => (r.path === '/me' ? { status: 500 } : h(r)),
      createMemoryTokenStorage(hint),
    );
    expect((await w.session.start()).status).toBe('authenticated');
    expect(w.session.getState().user).toEqual({ id: 'u1', nickname: 'Zé' });
  });
});

describe('web: migração do refresh legado do localStorage', () => {
  const legacy: StoredSession = { refreshToken: 'LEGADO', userId: 'u1', nickname: 'Zé' };

  it('troca o legado por cookie (corpo + X-Client), apaga o valor local e segue sem refresh', async () => {
    const { session, storage, calls } = make(routes(), createMemoryTokenStorage(legacy));
    expect((await session.start()).status).toBe('authenticated');
    const migrate = calls.filter((c) => c.path === '/auth/refresh');
    expect(migrate).toHaveLength(1); // uma troca só: o access dela já serve
    expect(migrate[0]?.body).toEqual({ refreshToken: 'LEGADO' });
    expect(migrate[0]?.headers['x-client']).toBe('web');
    const saved = await storage.load();
    expect(saved).toEqual({ userId: 'u1', nickname: 'Zé' });
    expect(JSON.stringify(saved)).not.toContain('LEGADO');
  });

  it('legado recusado (401): limpa o armazenamento e tenta o cookie; sem cookie, vira convidado', async () => {
    const f = routes();
    const { session, storage, calls } = make(
      (r) =>
        r.path === '/auth/refresh'
          ? { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } }
          : f(r),
      createMemoryTokenStorage(legacy),
    );
    expect((await session.start()).status).toBe('authenticated');
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh', '/auth/refresh', '/auth/guest']);
    expect(calls[0]?.body).toEqual({ refreshToken: 'LEGADO' });
    expect(calls[1]?.body).toBeUndefined();
    expect(await storage.load()).toEqual({ userId: 'g1', nickname: 'Convidado' });
  });

  it('rede fora na migração: unavailable e o legado continua guardado', async () => {
    const storage = createMemoryTokenStorage(legacy);
    const { session } = make(() => 'throw', storage);
    expect((await session.start()).status).toBe('unavailable');
    expect(await storage.load()).toEqual(legacy);
  });
});

/** Access no formato JWT (só o payload importa ao cliente). */
const jwt = (sub: string, n = 0) =>
  `h.${globalThis.btoa(JSON.stringify({ sub, n })).replace(/=+$/, '')}.s`;

describe('web: dono do cookie (corrida de abas)', () => {
  it('refresh devolve access de OUTRO usuário: relê /me e adota o dono do token', async () => {
    let owner = 'u1';
    const { session, storage, calls } = make((r) => {
      if (r.path === '/auth/refresh') {
        return { status: 200, json: { accessToken: jwt(owner), expiresIn: 900 } };
      }
      if (r.path === '/me') {
        return {
          status: 200,
          json: { id: owner, nickname: owner === 'u1' ? 'Zé' : 'Bia', provider: 'guest' },
        };
      }
      return { status: 404 };
    });
    await session.start();
    expect(session.getState().user?.id).toBe('u1');
    owner = 'u2'; // outra aba trocou o cookie
    await session.forceRefresh();
    await new Promise((r) => setTimeout(r, 10));
    expect(session.getState().user).toMatchObject({ id: 'u2', nickname: 'Bia' });
    expect(await storage.load()).toEqual({ userId: 'u2', nickname: 'Bia' });
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(2);
  });

  it('mesmo dono: não relê /me', async () => {
    const { session, calls } = make((r) =>
      r.path === '/auth/refresh'
        ? { status: 200, json: { accessToken: jwt('u1'), expiresIn: 900 } }
        : r.path === '/me'
          ? { status: 200, json: me }
          : { status: 404 },
    );
    await session.start();
    await session.forceRefresh();
    await new Promise((r) => setTimeout(r, 5));
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(1);
  });
});

describe('web: migração dentro da trava', () => {
  const legacy: StoredSession = { refreshToken: 'LEGADO', userId: 'u1', nickname: 'Zé' };

  it('relê o armazenamento dentro da trava: outra aba já migrou, então não reapresenta o legado', async () => {
    const storage = createMemoryTokenStorage(legacy);
    const f = fakeFetch(routes());
    const session = createSession({
      storage,
      baseUrl: 'http://srv',
      fetch: f.fetch,
      webSession: true,
      refreshLock: async (fn) => {
        await storage.save({ userId: 'u1', nickname: 'Zé' }); // a outra aba migrou enquanto esperávamos
        return fn();
      },
    });
    expect((await session.start()).status).toBe('authenticated');
    const refreshes = f.calls.filter((c) => c.path === '/auth/refresh');
    expect(refreshes.every((c) => c.body === undefined)).toBe(true);
  });

  it('grava v2 e apaga o legado logo após o refresh, mesmo se /me falhar', async () => {
    const f = routes();
    const storage = createMemoryTokenStorage(legacy);
    const { session } = make((r) => (r.path === '/me' ? { status: 401 } : f(r)), storage);
    await session.start();
    expect(await storage.load()).toEqual({ userId: 'u1', nickname: 'Zé' });
  });
});

describe('web: logout, apagar conta, login social', () => {
  it('logout: POST /auth/logout sem corpo, limpa o armazenamento', async () => {
    const { session, storage, calls } = make(routes(), createMemoryTokenStorage(hint));
    await session.start();
    await session.logout();
    const out = calls.find((c) => c.path === '/auth/logout');
    expect(out?.method).toBe('POST');
    expect(out?.body).toBeUndefined();
    expect(out?.headers['x-client']).toBe('web');
    expect(out?.headers['authorization']).toBe('Bearer a2');
    expect(await storage.load()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signedOut', user: null });
  });

  it('apagar conta: DELETE /auth/account sem corpo; some do armazenamento', async () => {
    const { session, storage, calls } = make(
      routes((r) => (r.path === '/auth/account' ? { status: 204 } : { status: 404 })),
      createMemoryTokenStorage(hint),
    );
    await session.start();
    await session.deleteAccount();
    const del = calls.find((c) => c.path === '/auth/account');
    expect(del?.method).toBe('DELETE');
    expect(del?.body).toBeUndefined();
    expect(del?.headers['x-client']).toBe('web');
    expect(calls.some((c) => c.path === '/me' && c.method === 'DELETE')).toBe(false);
    expect(await storage.load()).toBeNull();
    expect(session.getState().status).toBe('signedOut');
  });

  it('login social não revoga o convidado anterior (o cookie já é o da conta nova)', async () => {
    const { session, calls, storage } = make(
      routes((r) =>
        r.path === '/auth/google'
          ? {
              status: 200,
              json: { ...web(7), user: { id: 'u9', nickname: 'Ana' }, created: false },
            }
          : { status: 404 },
      ),
      createMemoryTokenStorage(hint),
    );
    await session.start();
    await session.loginSocial({ provider: 'google', idToken: 't', nonce: 'n' });
    expect(calls.some((c) => c.path === '/auth/logout')).toBe(false);
    expect(session.getState().user).toMatchObject({ id: 'u9', provider: 'google' });
    expect(await storage.load()).toEqual({ userId: 'u9', nickname: 'Ana' });
    expect(session.getAccessToken()).toBe('a7');
  });

  it('vínculo: resposta sem refreshToken é aceita e nada de refresh é guardado', async () => {
    const { session, storage } = make(
      routes((r) =>
        r.path === '/auth/link'
          ? { status: 200, json: { ...web(5), user: { id: 'u1', nickname: 'Zé' }, created: false } }
          : { status: 404 },
      ),
      createMemoryTokenStorage(hint),
    );
    await session.start();
    await session.linkAccount({ provider: 'apple', idToken: 't', nonce: 'n' });
    expect(session.getState().user).toMatchObject({ id: 'u1', provider: 'apple' });
    expect(JSON.stringify(await storage.load())).not.toContain('refresh');
  });

  it('setNickname grava só o usuário', async () => {
    const { session, storage } = make(
      routes((r) =>
        r.path === '/me' && r.method === 'PUT'
          ? { status: 200, json: { nickname: 'Novo' } }
          : { status: 404 },
      ),
      createMemoryTokenStorage(hint),
    );
    await session.start();
    await session.setNickname('Novo');
    expect(await storage.load()).toEqual({ userId: 'u1', nickname: 'Novo' });
  });

  it('outra aba entra com outro usuário: adota e renova o access para alinhar', async () => {
    const holder: { fire?: (s: StoredSession) => void } = {};
    const base = createMemoryTokenStorage(hint);
    const storage = {
      ...base,
      subscribe: (l: (s: StoredSession) => void) => {
        holder.fire = l;
        return () => undefined;
      },
    };
    const { session, calls } = make(routes(), storage);
    await session.start();
    const before = calls.filter((c) => c.path === '/auth/refresh').length;
    holder.fire?.({ userId: 'u1', nickname: 'Zé' }); // mesmo usuário: nada
    await new Promise((r) => setTimeout(r, 5));
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(before);
    holder.fire?.({ userId: 'u2', nickname: 'Bia' });
    await new Promise((r) => setTimeout(r, 5));
    expect(session.getState().user).toMatchObject({ id: 'u2', nickname: 'Bia' });
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(before + 1);
  });
});

describe('web: cliente HTTP', () => {
  const client = (crossOrigin: boolean, h: Handler = routes()) => {
    const f = fakeFetch(h);
    const api = createApiClient({
      baseUrl: 'http://srv',
      fetch: f.fetch,
      webSession: true,
      crossOrigin,
      auth: {
        getAccessToken: () => 'acc',
        getRefreshToken: () => '<cookie>',
        setTokens: () => Promise.resolve(),
        onRefreshRejected: () => undefined,
      },
    });
    return { api, ...f };
  };

  it('X-Client só em /auth/*; /auth/* usa include entre origens e same-origin na mesma; nunca omit', async () => {
    const cross = client(true, () => ({ status: 200, json: {} }));
    await cross.api.nonce().catch(() => undefined);
    await cross.api.health();
    expect(cross.calls[0]).toMatchObject({ path: '/auth/nonce', credentials: 'include' });
    expect(cross.calls[0]?.headers['x-client']).toBe('web');
    expect(cross.calls[1]).toMatchObject({ path: '/health', credentials: 'omit' });
    expect(cross.calls[1]?.headers['x-client']).toBeUndefined();

    const same = client(false, () => ({ status: 200, json: {} }));
    await same.api.nonce().catch(() => undefined);
    expect(same.calls[0]).toMatchObject({ credentials: 'same-origin' }); // nunca omit: o cookie seria descartado
    expect(same.calls[0]?.headers['x-client']).toBe('web');
  });

  it('refreshSession (fila única) manda corpo vazio e aceita a resposta sem refreshToken', async () => {
    const { api, calls } = client(false);
    const [a, b] = await Promise.all([api.refreshSession(), api.refreshSession()]);
    expect([a, b]).toEqual(['a2', 'a2']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toBeUndefined();
  });

  it('migrateLegacyRefresh manda o corpo; 401 sobe e não repete', async () => {
    const ok = client(false);
    await ok.api.migrateLegacyRefresh('R');
    expect(ok.calls[0]?.body).toEqual({ refreshToken: 'R' });
    const bad = client(false, () => ({
      status: 401,
      json: { error: { code: 'INVALID_REFRESH_TOKEN' } },
    }));
    const e = await bad.api.migrateLegacyRefresh('R').catch((x: unknown) => x);
    expect(isApiError(e) && e.status).toBe(401);
    expect(bad.calls).toHaveLength(1);
  });

  it('nonce: devolve o valor; resposta sem nonce é INVALID_RESPONSE', async () => {
    const ok = client(false, () => ({ status: 200, json: { nonce: 'abc', expiresIn: 300 } }));
    expect(await ok.api.nonce()).toBe('abc');
    expect(ok.calls[0]?.method).toBe('GET');
    const bad = client(false, () => ({ status: 200, json: { expiresIn: 300 } }));
    await expect(bad.api.nonce()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
});

describe('nativo: nada muda', () => {
  it('sem X-Client, com credentials omit, refresh no corpo e resposta com refreshToken obrigatório', async () => {
    const f = fakeFetch((r) =>
      r.path === '/auth/refresh'
        ? { status: 200, json: { accessToken: 'a', expiresIn: 900 } } // sem refreshToken: inválido no nativo
        : { status: 404 },
    );
    const api = createApiClient({
      baseUrl: 'http://srv',
      fetch: f.fetch,
      auth: {
        getAccessToken: () => null,
        getRefreshToken: () => 'r1',
        setTokens: () => Promise.resolve(),
        onRefreshRejected: () => undefined,
      },
    });
    await expect(api.refreshSession()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(f.calls[0]?.body).toEqual({ refreshToken: 'r1' });
    expect(f.calls[0]?.headers['x-client']).toBeUndefined();
    expect(f.calls[0]?.credentials).toBe('omit');
  });
});
