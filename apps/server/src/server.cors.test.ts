/**
 * CORS e wrapper do `/matchmake/reconnect` pelo servidor REAL (`createServer`): o roteador do
 * `@colyseus/core` responde a `OPTIONS` e a `/matchmake/*` ANTES do express, então só um teste ponta a
 * ponta enxerga o que o navegador enxerga. UM `Server` por arquivo (matchmaker global).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from './auth/authService';
import type { AuthConfig } from './auth/config';
import { MemoryTokenStore } from './auth/tokenStore';
import { createMemoryRepositories } from './db';
import { createServer, type RunningServer } from './server';

const CFG: AuthConfig = {
  secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
  issuer: 'trucaco',
  audience: 'trucaco-api',
  accessTtlSec: 900,
  refreshTtlSec: 3600,
  refreshReuseGraceSec: 20,
  refreshFamilyMaxSec: 7_776_000,
  clockToleranceSec: 5,
};
const ALLOWED = 'https://app.trucaco.test';
const EVIL = 'https://evil.test';

let server: RunningServer;
let base: string;

beforeAll(async () => {
  const repos = createMemoryRepositories();
  const auth = new AuthService(repos.users, new MemoryTokenStore(), CFG);
  server = await createServer({
    port: 0,
    deps: { auth, users: repos.users, corsOrigins: [ALLOWED] },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

const preflight = (path: string, origin: string, method: string): Promise<Response> =>
  fetch(`${base}${path}`, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': 'authorization, content-type',
    },
  });

describe('CORS pelo servidor real', () => {
  const paths: [string, string][] = [
    ['/me', 'PUT'],
    ['/me', 'GET'],
    ['/me/avatar', 'PUT'],
    ['/me/partners/abc/codes', 'PUT'],
    ['/auth/refresh', 'POST'],
    ['/matchmake/create/truco', 'POST'],
    ['/matchmake/reconnect/xyz', 'POST'],
  ];

  it.each(paths)(
    'preflight de origem permitida em %s (%s) libera GET/POST/PUT',
    async (path, m) => {
      const res = await preflight(path, ALLOWED, m);
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get('access-control-allow-origin')).toBe(ALLOWED);
      const methods = (res.headers.get('access-control-allow-methods') ?? '')
        .split(',')
        .map((s) => s.trim());
      expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'PUT', 'OPTIONS']));
      expect(res.headers.get('access-control-allow-headers')).toBe(
        'Authorization, Content-Type, X-Client',
      );
      expect(res.headers.get('access-control-allow-credentials')).toBe('true');
    },
  );

  it.each(paths)('preflight de origem FORA da lista em %s (%s): 403 sem CORS', async (path, m) => {
    const res = await preflight(path, EVIL, m);
    expect(res.status).toBe(403);
    for (const [name] of res.headers) expect(name).not.toMatch(/^access-control-/);
  });

  it('nunca reflete `null`, `*` nem origem parecida', async () => {
    for (const origin of ['null', '*', `${ALLOWED}.evil.test`, 'http://app.trucaco.test']) {
      const res = await preflight('/me', origin, 'PUT');
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });

  it('requisição real: origem permitida recebe o cabeçalho; fora da lista, nenhum', async () => {
    const ok = await fetch(`${base}/health`, { headers: { origin: ALLOWED } });
    expect(ok.headers.get('access-control-allow-origin')).toBe(ALLOWED);
    const bad = await fetch(`${base}/health`, { headers: { origin: EVIL } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const mm = await fetch(`${base}/matchmake/create/truco`, {
      method: 'POST',
      headers: { origin: EVIL, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mm.headers.get('access-control-allow-origin')).toBeNull();
    const mmOk = await fetch(`${base}/matchmake/create/truco`, {
      method: 'POST',
      headers: { origin: ALLOWED, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(mmOk.headers.get('access-control-allow-origin')).toBe(ALLOWED);
  });
});
