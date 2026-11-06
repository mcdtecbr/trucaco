/**
 * Web na mesma origem pelo servidor REAL (`createServer` com `webDistDir`): o roteador do Colyseus não
 * pode engolir `GET /` nem as páginas, e a API segue com os cabeçalhos travados. UM `Server` por arquivo.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let server: RunningServer;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'trucaco-web-srv-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Trucaço</title>');
  const repos = createMemoryRepositories();
  const auth = new AuthService(repos.users, new MemoryTokenStore(), CFG);
  server = await createServer({
    port: 0,
    deps: { auth, users: repos.users, webDistDir: dir },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('servidor real com WEB_DIST_DIR', () => {
  it('GET / e páginas devolvem o index.html; a API e o health seguem normais', async () => {
    for (const path of ['/', '/lobby']) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('Trucaço');
    }
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(((await health.json()) as { status: string }).status).toBe('ok');
    const guest = await fetch(`${base}/auth/guest`, {
      method: 'POST',
      headers: { 'x-client': 'web', origin: base },
    });
    expect(guest.status).toBe(201);
    const cookie = guest.headers.getSetCookie().find((c) => c.startsWith('refresh=')) ?? '';
    // em teste (NODE_ENV=test) o cookie não leva Secure (http local)
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Secure');
    expect(((await guest.json()) as Record<string, unknown>)['refreshToken']).toBeUndefined();
    const missing = await fetch(`${base}/auth/nao-existe`);
    expect(missing.status).toBe(404);
  });
});
