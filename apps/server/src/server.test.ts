import { matchMaker } from '@colyseus/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@trucaco/protocol';
import { normalizeIp } from './rateLimit';
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

describe('SlidingWindowLimiter: teto de chaves', () => {
  it('descarta as chaves mais antigas ao passar do teto, sem crescer sem limite', () => {
    const l = new SlidingWindowLimiter(1, 60_000, 100);
    for (let i = 0; i < 10_000; i++) expect(l.allow(`ip${i}`, i)).toBe(true);
    expect(l.size).toBe(100);
    // chave recente ainda é lembrada; a antiga foi esquecida (ganha nova cota)
    expect(l.allow('ip9999', 10_000)).toBe(false);
    expect(l.allow('ip0', 10_001)).toBe(true);
  });

  it('chave tocada recentemente sobrevive; rejeitadas não são contadas', () => {
    const l = new SlidingWindowLimiter(2, 1000, 3);
    l.allow('a', 0);
    l.allow('b', 1);
    l.allow('c', 2);
    l.allow('a', 3); // renova 'a'
    l.allow('d', 4); // expulsa 'b' (a mais antiga)
    expect(l.allow('a', 5)).toBe(false); // a tinha 2 acessos
    expect(l.allow('b', 6)).toBe(true);
    expect(l.allow('x', 0)).toBe(true);
  });
});

describe('normalizeIp', () => {
  it('IPv4 fica; IPv4 mapeado em IPv6 vira IPv4; IPv6 vira o /64', () => {
    expect(normalizeIp('203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(normalizeIp('::ffff:cb00:7107')).toBe('203.0.113.7');
    expect(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64');
    expect(normalizeIp('2001:db8:1:2:1::9')).toBe('2001:db8:1:2::/64');
    expect(normalizeIp('2001:DB8:1:2::1')).toBe(normalizeIp('2001:db8:1:2:ffff::'));
    expect(normalizeIp('2001:db8:1:3::1')).not.toBe(normalizeIp('2001:db8:1:2::1'));
    expect(normalizeIp('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
    expect(normalizeIp('::1')).toBe('0:0:0:0::/64');
    expect(normalizeIp('lixo'.repeat(40))).toHaveLength(64);
  });
});
