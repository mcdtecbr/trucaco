import { describe, expect, it } from 'vitest';
import { createSession } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { StoredSession } from './tokenStorageCore';
import { fakeFetch } from './testHelpers';
import type { Handler } from './testHelpers';

const refreshRes = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, expiresIn: 900 });
const stored: StoredSession = { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' };

function setup(handler: Handler, initial: StoredSession | null = stored) {
  const storage = createMemoryTokenStorage(initial);
  const f = fakeFetch(handler);
  const session = createSession({ storage, baseUrl: 'http://x', fetch: f.fetch });
  return { session, storage, ...f };
}

describe('provider na sessão', () => {
  it('convidado novo já nasce com provider guest, sem chamar /me', async () => {
    const { session, calls } = setup(
      () => ({
        status: 201,
        json: { ...refreshRes(1), user: { id: 'u9', nickname: 'G' } },
      }),
      null,
    );
    await session.start();
    expect(session.getState().user?.provider).toBe('guest');
    await session.loadProvider();
    expect(calls.map((c) => c.path)).toEqual(['/auth/guest']);
  });

  it('sessão restaurada lê o provider de GET /me uma vez e o mantém ao trocar o apelido', async () => {
    const { session, calls } = setup((r) => {
      if (r.path === '/auth/refresh') return { status: 200, json: refreshRes(2) };
      if (r.path === '/me' && r.method === 'GET')
        return { status: 200, json: { provider: 'google' } };
      return { status: 200, json: { nickname: 'Novo' } };
    });
    await session.start();
    expect(session.getState().user?.provider).toBeUndefined();
    await session.loadProvider();
    await session.loadProvider();
    expect(session.getState().user?.provider).toBe('google');
    expect(calls.filter((c) => c.path === '/me' && c.method === 'GET')).toHaveLength(1);
    await session.setNickname('Novo');
    expect(session.getState().user).toMatchObject({ nickname: 'Novo', provider: 'google' });
  });

  it('falha em /me não derruba a sessão nem inventa provider', async () => {
    const { session } = setup((r) =>
      r.path === '/auth/refresh' ? { status: 200, json: refreshRes(2) } : 'throw',
    );
    await session.start();
    await session.loadProvider();
    expect(session.getState()).toMatchObject({ status: 'authenticated' });
    expect(session.getState().user?.provider).toBeUndefined();
  });
});

describe('loadProvider: sem rajada e sem laço', () => {
  it('chamadas concorrentes compartilham um único GET /me', async () => {
    const { session, calls } = setup((r) => {
      if (r.path === '/auth/refresh') return { status: 200, json: refreshRes(2) };
      return { status: 200, json: { provider: 'apple' } };
    });
    await session.start();
    await Promise.all([session.loadProvider(), session.loadProvider(), session.loadProvider()]);
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(1);
    expect(session.getState().user?.provider).toBe('apple');
  });

  it('falha em /me não é repetida por notificações nem por novas chamadas', async () => {
    const { session, calls } = setup((r) => {
      if (r.path === '/auth/refresh') return { status: 200, json: refreshRes(2) };
      return { status: 503 };
    });
    const unsub = session.subscribe((st) => {
      if (st.status === 'authenticated') void session.loadProvider();
    });
    await session.start();
    await session.loadProvider();
    await session.loadProvider();
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(1);
    expect(session.getState().user?.provider).toBeUndefined();
    unsub();
  });
});

describe('deleteAccount', () => {
  it('envia o refresh atual, limpa o armazenamento e vira signedOut', async () => {
    const { session, storage, calls } = setup((r) =>
      r.path === '/auth/refresh' ? { status: 200, json: refreshRes(2) } : { status: 204 },
    );
    await session.start();
    await session.deleteAccount();
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del).toMatchObject({ path: '/me', body: { refreshToken: 'r2' } });
    expect(await storage.load()).toBeNull();
    expect(session.getState()).toEqual({ status: 'signedOut', user: null });
    expect(session.getAccessToken()).toBeNull();
  });

  it('erro do servidor mantém a sessão e o armazenamento', async () => {
    const { session, storage } = setup((r) =>
      r.path === '/auth/refresh'
        ? { status: 200, json: refreshRes(2) }
        : { status: 401, json: { error: { code: 'INVALID_REFRESH_TOKEN' } } },
    );
    await session.start();
    await expect(session.deleteAccount()).rejects.toMatchObject({ code: 'INVALID_REFRESH_TOKEN' });
    expect(session.getState().status).toBe('authenticated');
    expect((await storage.load())?.refreshToken).toBe('r2');
  });
});
