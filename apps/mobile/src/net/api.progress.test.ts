import { describe, expect, it } from 'vitest';
import { createApiClient } from './api';
import { fakeFetch } from './testHelpers';
import type { Handler } from './testHelpers';

function client(handler: Handler) {
  const f = fakeFetch(handler);
  const api = createApiClient({
    baseUrl: 'http://x',
    fetch: f.fetch,
    auth: {
      getAccessToken: () => 'acc',
      getRefreshToken: () => 'ref',
      setTokens: () => Promise.resolve(),
      onRefreshRejected: () => undefined,
    },
  });
  return { api, calls: f.calls };
}

describe('api: conquistas, missões e perfil público', () => {
  it('rotas e Bearer', async () => {
    const { api, calls } = client((r) => ({
      status: 200,
      json: r.path === '/me/missions' ? { missions: [] } : { achievements: [] },
    }));
    await api.myAchievements();
    await api.myMissions();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /me/achievements',
      'GET /me/missions',
    ]);
    expect(calls[0]?.headers['authorization']).toBe('Bearer acc');
  });

  it('perfil público codifica o id e traduz USER_NOT_FOUND', async () => {
    const { api, calls } = client(() => ({
      status: 404,
      json: { error: { code: 'USER_NOT_FOUND' } },
    }));
    await expect(api.publicProfile('a/b')).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
    expect(calls[0]?.path).toBe('/users/a%2Fb');
  });

  it('login social vai para a rota do provedor sem Bearer e valida a resposta', async () => {
    const { api, calls } = client(() => ({
      status: 201,
      json: {
        accessToken: 'a',
        refreshToken: 'r',
        expiresIn: 900,
        user: { id: 'u', nickname: 'N' },
        created: true,
      },
    }));
    const res = await api.loginSocial({ provider: 'google', idToken: 't' });
    expect(res.created).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/google' });
    expect(calls[0]?.headers['authorization']).toBeUndefined();
  });

  it('vínculo não repete o idToken em 401 (INVALID_ID_TOKEN)', async () => {
    const { api, calls } = client(() => ({
      status: 401,
      json: { error: { code: 'INVALID_ID_TOKEN' } },
    }));
    await expect(api.linkAccount({ provider: 'apple', idToken: 't' })).rejects.toMatchObject({
      code: 'INVALID_ID_TOKEN',
    });
    expect(calls).toHaveLength(1);
  });
});
