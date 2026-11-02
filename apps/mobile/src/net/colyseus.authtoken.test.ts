/**
 * `new Client` do SDK lê `localStorage['colyseus-auth-token']` e `buildEndpoint` poria o valor na query
 * (`_authToken`). Este arquivo é separado porque o SDK guarda o storage na primeira leitura (módulo).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Session } from './session';

const STRAY = 'JWT-ANTIGO-DO-LOCALSTORAGE';

beforeAll(() => {
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => (k === 'colyseus-auth-token' ? STRAY : null),
      setItem: () => undefined,
      removeItem: () => undefined,
    },
  });
});
afterAll(() => vi.unstubAllGlobals());

function session(): Session {
  return {
    getAccessToken: () => 'access',
    onAccessTokenChange: () => () => undefined,
    ensureAccessToken: () => Promise.resolve('access'),
    forceRefresh: () => Promise.resolve('access'),
  } as unknown as Session;
}

describe('BearerClient e o token legado do storage do SDK', () => {
  it('http.authToken fica indefinido e o endpoint nunca leva _authToken', async () => {
    const { createGameClient } = await import('./colyseus');
    const gc = createGameClient(session(), { serverUrl: 'http://localhost:2567' });
    const client = gc.client as unknown as {
      http: { authToken: string | undefined };
      buildEndpoint(r: unknown, o?: Record<string, unknown>): string;
    };
    // Sem a defesa, o SDK teria lido STRAY do localStorage falso no construtor.
    expect(client.http.authToken).toBeUndefined();
    client.http.authToken = STRAY; // nem uma escrita posterior (leitura assíncrona) pega
    expect(client.http.authToken).toBeUndefined();
    const url = client.buildEndpoint(
      { name: 'truco', roomId: 'r', sessionId: 's', processId: 'p' },
      { sessionId: 's', _authToken: STRAY },
    );
    expect(url).not.toContain('_authToken');
    expect(url).not.toContain(STRAY);
    expect(url).toContain('sessionId=s');
    gc.dispose();
  });
});
