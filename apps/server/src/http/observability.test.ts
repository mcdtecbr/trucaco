/**
 * Observabilidade (7F): request id, `/metrics` protegido por token, contadores sem PII.
 */
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { setLogSink, type LogFields, type LogLevel } from '../logger';
import { MAX_ERROR_CODES, Metrics, OTHER_ERROR_CODE } from '../metrics';
import { installRequestId, mountMetrics, resolveRequestId } from './observability';
import { installBaseMiddleware, mountFallbacks } from './rest';

const TOKEN = 'm'.repeat(20) + 'Z'.repeat(20);
const running: HttpServer[] = [];
let restoreLog: (() => void) | null = null;
afterEach(async () => {
  restoreLog?.();
  restoreLog = null;
  await Promise.all(running.splice(0).map((s) => new Promise((r) => s.close(r))));
});

interface Logged {
  level: LogLevel;
  msg: string;
  fields: LogFields;
}

async function start(opts: { token?: string; metrics?: Metrics } = {}) {
  const logs: Logged[] = [];
  restoreLog = setLogSink((level, msg, fields) => logs.push({ level, msg, fields }));
  const metrics = opts.metrics ?? new Metrics();
  const app = express();
  installRequestId(app, metrics);
  installBaseMiddleware(app, { corsOrigins: [], hsts: false });
  mountMetrics(app, { token: opts.token, trustProxy: false, metrics });
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/boom', () => {
    throw new Error('segredo-interno');
  });
  app.get('/users/:id', (_req, res) => {
    res.status(404).json({ error: { code: 'USER_NOT_FOUND' } });
  });
  app.get('/silent', (_req, res) => {
    res.status(403).end();
  });
  mountFallbacks(app);
  const server = await new Promise<HttpServer>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  running.push(server);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    get: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init),
    logs,
    metrics,
  };
}

describe('request id', () => {
  it('aceita id válido do cliente e o devolve', async () => {
    const { get } = await start();
    const res = await get('/health', { headers: { 'X-Request-Id': 'abc-12345_XYZ' } });
    expect(res.headers.get('x-request-id')).toBe('abc-12345_XYZ');
  });

  it('gera um id quando falta, é curto demais, longo demais ou tem caractere inválido', async () => {
    const { get } = await start();
    for (const bad of ['abc', 'x'.repeat(65), 'tem espaco aqui', 'a<b>c-12345', 'ü-123456789']) {
      const res = await get('/health', { headers: { 'X-Request-Id': bad } });
      const id = res.headers.get('x-request-id');
      expect(id).not.toBe(bad);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    }
    const none = await get('/health');
    expect(none.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('resolveRequestId ignora cabeçalho repetido (lista)', () => {
    expect(resolveRequestId(['abcdefgh', 'ijklmnop'])).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('loga o erro 5xx e o 4xx com o id, a rota como padrão e sem PII', async () => {
    const { get, logs } = await start();
    const uid = '123e4567-e89b-42d3-a456-426614174000';
    await get(`/users/${uid}`, {
      headers: { 'X-Request-Id': 'req-4xx-0001', Authorization: 'Bearer x' },
    });
    const boom = await get('/boom', { headers: { 'X-Request-Id': 'req-5xx-0001' } });
    expect(boom.status).toBe(500);
    expect(boom.headers.get('x-request-id')).toBe('req-5xx-0001');
    const client = logs.find((l) => l.fields['requestId'] === 'req-4xx-0001');
    expect(client).toMatchObject({
      level: 'info',
      fields: { route: '/users/:id', status: 404, method: 'GET' },
    });
    const internal = logs.find((l) => l.msg === 'rest: erro interno');
    expect(internal?.fields['requestId']).toBe('req-5xx-0001');
    const all = JSON.stringify(logs);
    expect(all).not.toContain(uid);
    expect(all).not.toContain('segredo-interno');
    expect(all).not.toContain('Bearer');
    // /health e /metrics não geram linha de log por requisição.
    await get('/health');
    expect(logs.filter((l) => l.msg.startsWith('http:')).length).toBe(2);
  });

  it('conta erros por código e por status quando não há corpo', async () => {
    const { get, metrics } = await start();
    await get('/users/x');
    await get('/users/y');
    await get('/silent');
    await get('/nao-existe');
    const snap = metrics.snapshot({ queued: 0, tables: 0, users: 0, byTableSize: {} });
    expect(snap.httpErrorsByCode).toMatchObject({ USER_NOT_FOUND: 2, HTTP_403: 1, NOT_FOUND: 1 });
  });
});

describe('GET /metrics', () => {
  it('sem METRICS_TOKEN a rota não existe (404 padrão)', async () => {
    const { get } = await start();
    const res = await get('/metrics');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'NOT_FOUND' } });
  });

  it('exige o Bearer certo: sem cabeçalho, errado, esquema errado e prefixo do token dão 401', async () => {
    const { get } = await start({ token: TOKEN });
    for (const headers of [
      {},
      { Authorization: 'Bearer outro' },
      { Authorization: `Bearer ${TOKEN.slice(0, -1)}` },
      { Authorization: `Basic ${TOKEN}` },
      { Authorization: `Bearer ${TOKEN}x` },
    ] as Record<string, string>[]) {
      const res = await get('/metrics', { headers });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: 'UNAUTHORIZED' } });
    }
  });

  it('com o token devolve o JSON agregado, no-store, sem PII', async () => {
    const metrics = new Metrics();
    metrics.registerRoom('sala-secreta-1', () => ({
      visibility: 'private',
      seatsOccupied: 3,
      playersConnected: 2,
    }));
    metrics.registerRoom('sala-secreta-2', () => ({
      visibility: 'public',
      seatsOccupied: 4,
      playersConnected: 4,
    }));
    metrics.inc('reconnections', 2);
    metrics.inc('matchesSaved');
    metrics.inc('progressionApplied', 3);
    metrics.inc('progressionNotScored');
    const { get } = await start({ token: TOKEN, metrics });
    const res = await get('/metrics', { headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      protocolVersion: PROTOCOL_VERSION,
      rooms: { active: 2, private: 1, public: 1, seatsOccupied: 7, playersConnected: 6 },
      reconnections: 2,
      matches: { saved: 1, saveFailed: 0 },
      progression: { applied: 3, notScored: 1, duplicate: 0, invalid: 0, failed: 0 },
    });
    expect(typeof body['uptimeSeconds']).toBe('number');
    const text = JSON.stringify(body);
    expect(text).not.toContain('sala-secreta');
    expect(text).not.toMatch(/userId|nickname|email/i);
  });

  it('limita tentativas por IP', async () => {
    const { get } = await start({ token: TOKEN });
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await get('/metrics')).status;
    expect(last).toBe(429);
  });
});

describe('Metrics', () => {
  it('registerRoom devolve o remove e a sala some do total', () => {
    const m = new Metrics();
    const off = m.registerRoom('a', () => ({
      visibility: 'public',
      seatsOccupied: 1,
      playersConnected: 1,
    }));
    expect(m.snapshot({ queued: 0, tables: 0, users: 0, byTableSize: {} }).rooms.active).toBe(1);
    off();
    expect(m.snapshot({ queued: 0, tables: 0, users: 0, byTableSize: {} }).rooms.active).toBe(0);
  });

  it('código com forma inesperada e excesso de códigos distintos viram OTHER', () => {
    const m = new Metrics();
    m.httpError('lower case com espaço');
    for (let i = 0; i < MAX_ERROR_CODES + 10; i++) m.httpError(`CODE_${i}`);
    const snap = m.snapshot({ queued: 0, tables: 0, users: 0, byTableSize: {} });
    const keys = Object.keys(snap.httpErrorsByCode);
    expect(keys.length).toBeLessThanOrEqual(MAX_ERROR_CODES);
    expect(snap.httpErrorsByCode[OTHER_ERROR_CODE]).toBeGreaterThan(0);
  });

  it('uptime segue o relógio injetado', () => {
    let now = 1_000_000;
    const m = new Metrics(() => now);
    now += 90_500;
    expect(m.snapshot({ queued: 0, tables: 0, users: 0, byTableSize: {} }).uptimeSeconds).toBe(90);
  });
});
