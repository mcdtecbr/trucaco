import { describe, expect, it } from 'vitest';
import { isApiError } from './api';
import { createSession } from './session';
import { createMemoryTokenStorage } from './tokenStorageCore';
import type { StoredSession } from './tokenStorageCore';
import { fakeFetch } from './testHelpers';
import type { Handler } from './testHelpers';

const pair = (n: number) => ({ accessToken: `a${n}`, refreshToken: `r${n}`, expiresIn: 900 });
const stored: StoredSession = { refreshToken: 'r1', userId: 'u1', nickname: 'Zé' };
const req = { provider: 'google', idToken: 'tok', nonce: 'n1' } as const;

async function setup(handler: Handler) {
  const storage = createMemoryTokenStorage(stored);
  const f = fakeFetch((r) =>
    r.path === '/auth/refresh' ? { status: 200, json: pair(2) } : handler(r),
  );
  const session = createSession({ storage, baseUrl: 'http://x', fetch: f.fetch });
  await session.start();
  return { session, storage, ...f };
}

describe('vincular conta (convidado)', () => {
  it('troca o par de tokens, mantém o id e passa a ter o provider', async () => {
    const { session, storage, calls } = await setup(() => ({
      status: 200,
      json: { ...pair(3), user: { id: 'u1', nickname: 'Zé' }, created: false },
    }));
    await session.linkAccount(req);
    const link = calls.find((c) => c.path === '/auth/link');
    expect(link?.method).toBe('POST');
    expect(link?.body).toEqual(req);
    expect(link?.headers['authorization']).toBe('Bearer a2');
    expect(session.getState().user).toEqual({ id: 'u1', nickname: 'Zé', provider: 'google' });
    expect(await storage.load()).toMatchObject({ refreshToken: 'r3', userId: 'u1' });
    expect(session.getAccessToken()).toBe('a3');
  });

  it('PROVIDER_TAKEN sobe o erro e a sessão fica como estava', async () => {
    const { session, storage } = await setup(() => ({
      status: 409,
      json: { error: { code: 'PROVIDER_TAKEN' } },
    }));
    const err = await session.linkAccount(req).catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('PROVIDER_TAKEN');
    expect(session.getState().user?.provider).toBeUndefined();
    expect(await storage.load()).toMatchObject({ refreshToken: 'r2' });
  });

  it('resposta inválida do servidor vira INVALID_RESPONSE', async () => {
    const { session } = await setup(() => ({ status: 200, json: { ok: true } }));
    const err = await session.linkAccount(req).catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('INVALID_RESPONSE');
  });
});

describe('entrar com conta social', () => {
  it('substitui o convidado: novo usuário, par novo guardado, sem Bearer', async () => {
    const { session, storage, calls } = await setup(() => ({
      status: 201,
      json: { ...pair(5), user: { id: 'u9', nickname: 'Ana' }, created: true },
    }));
    await session.loginSocial({ provider: 'apple', idToken: 't', nonce: 'n' });
    const call = calls.find((c) => c.path === '/auth/apple');
    expect(call?.headers['authorization']).toBeUndefined();
    expect(session.getState()).toMatchObject({
      status: 'authenticated',
      user: { id: 'u9', nickname: 'Ana', provider: 'apple' },
    });
    expect(await storage.load()).toMatchObject({ refreshToken: 'r5', userId: 'u9' });
  });

  it('SOCIAL_LOGIN_DISABLED (503) sobe sem derrubar a sessão', async () => {
    const { session } = await setup(() => ({
      status: 503,
      json: { error: { code: 'SOCIAL_LOGIN_DISABLED' } },
    }));
    const err = await session.loginSocial(req).catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('SOCIAL_LOGIN_DISABLED');
    expect(session.getState()).toMatchObject({ status: 'authenticated', user: { id: 'u1' } });
  });
});

describe('vínculo: corridas e conta já vinculada', () => {
  it('logout durante o vínculo: o resultado é descartado e a sessão não ressuscita', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const { session, storage } = await setup(async (r) => {
      if (r.path === '/auth/logout') return { status: 204 };
      await gate;
      return {
        status: 200,
        json: { ...pair(7), user: { id: 'u1', nickname: 'Zé' }, created: false },
      };
    });
    const pending = session.linkAccount(req);
    await tickMs();
    await session.logout();
    release?.();
    await pending;
    expect(session.getState()).toMatchObject({ status: 'signedOut', user: null });
    expect(await storage.load()).toBeNull();
    expect(session.getAccessToken()).toBeNull();
  });

  it('ALREADY_LINKED relê /me e passa a mostrar o provider real', async () => {
    const { session, calls } = await setup((r) => {
      if (r.path === '/me') return { status: 200, json: { provider: 'apple' } };
      return { status: 409, json: { error: { code: 'ALREADY_LINKED' } } };
    });
    const err = await session.linkAccount(req).catch((e: unknown) => e);
    expect(isApiError(err) && err.code).toBe('ALREADY_LINKED');
    expect(calls.filter((c) => c.path === '/me')).toHaveLength(1);
    expect(session.getState().user?.provider).toBe('apple');
  });
});

describe('entrar com conta social: revoga o convidado anterior', () => {
  const login = (r: { path: string }) =>
    r.path === '/auth/logout'
      ? { status: 204 }
      : {
          status: 201,
          json: { ...pair(5), user: { id: 'u9', nickname: 'Ana' }, created: true },
        };

  it('chama /auth/logout com o refresh antigo e então adota o par novo', async () => {
    const { session, calls } = await setup(login);
    await session.loginSocial(req);
    const paths = calls.map((c) => c.path);
    expect(paths.indexOf('/auth/logout')).toBeGreaterThan(paths.indexOf('/auth/google'));
    expect(calls.find((c) => c.path === '/auth/logout')?.body).toEqual({ refreshToken: 'r2' });
    expect(session.getState().user?.id).toBe('u9');
  });

  it('falha ao revogar não impede a entrada', async () => {
    const { session } = await setup((r) => (r.path === '/auth/logout' ? 'throw' : login(r)));
    await session.loginSocial(req);
    expect(session.getState()).toMatchObject({ status: 'authenticated', user: { id: 'u9' } });
  });
});

function tickMs(): Promise<void> {
  return new Promise((r) => setTimeout(r, 5));
}
