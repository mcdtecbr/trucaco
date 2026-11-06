/**
 * Estático do web na mesma origem (7A): arquivos, fallback para `index.html` só em páginas, API intacta,
 * cabeçalhos de cache e CSP. Pasta temporária com um export de mentira.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBaseMiddleware, mountFallbacks } from './rest';
import { API_PREFIXES, assertWebDist, isApiPath, mountWeb, webCsp } from './web';

let dir: string;
const running: HttpServer[] = [];

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'trucaco-web-'));
  mkdirSync(join(dir, '_expo', 'static', 'js', 'web'), { recursive: true });
  mkdirSync(join(dir, 'assets'), { recursive: true });
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Trucaço</title>');
  writeFileSync(join(dir, '_expo', 'static', 'js', 'web', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'logo.png'), 'png');
  writeFileSync(join(dir, 'favicon.ico'), 'ico');
  mkdirSync(join(dir, 'assets', '__node_modules', '.pnpm', 'pkg@1.0.0', 'icons'), {
    recursive: true,
  });
  writeFileSync(
    join(dir, 'assets', '__node_modules', '.pnpm', 'pkg@1.0.0', 'icons', 'a.png'),
    'png',
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function start() {
  const app = express();
  installBaseMiddleware(app, { corsOrigins: [], hsts: false });
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.post('/auth/guest', (_req, res) => {
    res.status(201).json({ ok: true });
  });
  mountWeb(app, { dir, insecureWs: true });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { get: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init), base };
}

describe('estático do web', () => {
  it('serve index.html na raiz e em rotas de página (fallback), com CSP própria e no-cache', async () => {
    const { get, base } = await start();
    for (const path of ['/', '/lobby', '/mesa/ABCD2345', '/perfil/historico']) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
      expect(await res.text()).toContain('Trucaço');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      const csp = res.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain(`ws://${base.slice('http://'.length)}`);
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
    }
  });

  it('arquivos com hash em /_expo/ e /assets/ são imutáveis; os demais têm cache curto', async () => {
    const { get } = await start();
    const js = await get('/_expo/static/js/web/app-abc123.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(js.headers.get('content-type')).toContain('javascript');
    const png = await get('/assets/logo.png');
    expect(png.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const ico = await get('/favicon.ico');
    expect(ico.status).toBe(200);
    expect(ico.headers.get('cache-control')).toBe('public, max-age=300');
    const index = await get('/index.html');
    expect(index.headers.get('cache-control')).toBe('no-cache');
  });

  it('serve assets do expo-router com segmento .pnpm; arquivo ausente continua 404; travessia de diretório não sai', async () => {
    const { get } = await start();
    const missing = await get('/_expo/static/js/web/nao-existe.js');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    expect((await get('/sumiu.png')).status).toBe(404);
    const pnpm = await get('/assets/__node_modules/.pnpm/pkg@1.0.0/icons/a.png');
    expect(pnpm.status).toBe(200);
    expect(pnpm.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect((await get('/assets/__node_modules/.pnpm/pkg@1.0.0/icons/b.png')).status).toBe(404);
    expect((await get('/..%2f..%2fpackage.json')).status).toBe(404);
    expect((await get('/assets/')).status).toBe(200); // diretório sem listagem: cai na página
  });

  it('a API não vira HTML: prefixos de API ausentes dão 404 JSON; a API real segue com a CSP travada', async () => {
    const { get } = await start();
    for (const path of [
      '/auth',
      '/auth/nada',
      '/me',
      '/matches/x',
      '/tables',
      '/queue',
      '/reports',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND' } });
    }
    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(health.headers.get('content-security-policy')).toBe(
      "default-src 'none'; frame-ancestors 'none'",
    );
    expect(health.headers.get('cache-control')).toBe('no-store');
    const post = await get('/auth/guest', { method: 'POST' });
    expect(post.status).toBe(201);
    expect(post.headers.get('cache-control')).toBe('no-store');
  });

  it('só GET/HEAD recebem a página; POST em rota de página é 404 JSON', async () => {
    const { get } = await start();
    const head = await get('/lobby', { method: 'HEAD' });
    expect(head.status).toBe(200);
    const post = await get('/lobby', { method: 'POST' });
    expect(post.status).toBe(404);
  });
});

describe('helpers do web', () => {
  it('isApiPath: prefixo exato ou com barra; /authx não é API', () => {
    for (const p of API_PREFIXES) {
      expect(isApiPath(p)).toBe(true);
      expect(isApiPath(`${p}/x`)).toBe(true);
    }
    expect(isApiPath('/authx')).toBe(false);
    expect(isApiPath('/mesa/1')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });

  it('CSP: sem host válido não abre ws arbitrário; com host, só o próprio', () => {
    expect(webCsp(undefined)).toContain("connect-src 'self'");
    expect(webCsp(undefined, true)).not.toContain('ws:');
    expect(webCsp('evil.com; script-src *')).not.toContain('evil.com');
    expect(webCsp('jogo.exemplo.com')).toContain('wss://jogo.exemplo.com');
    // produção: só wss://; ws:// apenas em dev/test
    expect(webCsp('jogo.exemplo.com')).not.toContain(' ws://');
    expect(webCsp('localhost:2567', true)).toContain('ws://localhost:2567 wss://localhost:2567');
    expect(webCsp('jogo.exemplo.com')).not.toContain("script-src 'self' *");
  });

  it('assertWebDist exige pasta com index.html', () => {
    expect(() => assertWebDist(dir)).not.toThrow();
    expect(() => assertWebDist(join(dir, 'assets'))).toThrow(/WEB_DIST_DIR/);
    expect(() => assertWebDist(join(dir, 'nao-existe'))).toThrow(/WEB_DIST_DIR/);
  });
});
