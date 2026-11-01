import { matchMaker } from '@colyseus/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { SlidingWindowLimiter, createServer, type RunningServer } from './server';

describe('createServer', () => {
  let server: RunningServer;

  beforeAll(async () => {
    server = await createServer({
      port: 0,
      matchmakeLimit: { max: 4, windowMs: 60_000 },
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /health responde ok com a versão do protocolo', async () => {
    expect(server.port).toBeGreaterThan(0);
    const res = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', protocol: PROTOCOL_VERSION });
  });

  const ROOM_OPTS = {
    variant: 'paulista',
    format: 'single',
    ironHand: true,
    visibility: 'private',
    userId: 'u1',
    nickname: 'Ana',
  };

  const post = (path: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${server.port}/matchmake/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ROOM_OPTS),
    });

  it('em produção create e joinOrCreate falham ANTES de criar a sala', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const before = (await matchMaker.query({ name: 'truco' })).length;
      for (const method of ['create', 'joinOrCreate']) {
        const res = await post(`${method}/truco`);
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).not.toBe(429);
      }
      expect((await matchMaker.query({ name: 'truco' })).length).toBe(before);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it('o limite por IP em /matchmake responde 429 após o excesso', async () => {
    // 2 requisições já foram gastas no teste anterior (limite 4 por janela).
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 4; i++) statuses.push((await post('create/truco')).status);
      expect(statuses.slice(0, 2).every((s) => s !== 429)).toBe(true);
      expect(statuses.slice(2)).toEqual([429, 429]);
      expect((await matchMaker.query({ name: 'truco' })).length).toBe(0);
      // Fora de /matchmake o limite não se aplica.
      expect((await fetch(`http://127.0.0.1:${server.port}/health`)).status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });
});

describe('SlidingWindowLimiter', () => {
  it('libera de novo quando a janela desliza e isola por chave', () => {
    const l = new SlidingWindowLimiter(2, 1000);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('a', 100)).toBe(true);
    expect(l.allow('a', 200)).toBe(false);
    expect(l.allow('b', 200)).toBe(true);
    expect(l.allow('a', 1001)).toBe(true);
  });
});
