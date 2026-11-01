/**
 * Integração com Redis REAL (`pnpm test:int`, só com `TEST_REDIS_URL`: host local e DB lógico != 0).
 * Roda a mesma bateria de contrato da memória e confere o formato das chaves (docs/banco-de-dados.md).
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db';
import { AuthService } from './authService';
import { REDIS_PREFIX, RedisTokenStore } from './redisTokenStore';
import { assertSafeTestRedisUrl } from './testRedis';
import { tokenStoreContract } from './tokenStore.contract';

const URL = assertSafeTestRedisUrl(process.env['TEST_REDIS_URL']);
let probe: Redis;

beforeAll(async () => {
  probe = new Redis(URL);
  // Só as chaves do Trucaco neste DB lógico descartável.
  const keys = await probe.keys(`${REDIS_PREFIX}*`);
  if (keys.length > 0) await probe.del(...keys);
});
afterAll(async () => {
  probe.disconnect();
});

tokenStoreContract('Redis', () => new RedisTokenStore(URL));

describe('RedisTokenStore: chaves e TTL', () => {
  const CFG = {
    secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
    issuer: 'trucaco',
    audience: 'trucaco-api',
    accessTtlSec: 900,
    refreshTtlSec: 120,
    clockToleranceSec: 5,
  };

  it('só hash no Redis, todo valor com TTL, lastJti atualizado e reuso revoga o access vigente', async () => {
    const store = new RedisTokenStore(URL);
    const repos = createMemoryRepositories();
    const auth = new AuthService(repos.users, store, CFG);
    const g = await auth.createGuest();
    const second = await auth.refresh(g.pair.refreshToken);

    const keys = await probe.keys(`${REDIS_PREFIX}*`);
    const mine = keys.filter((k) => k.startsWith(`${REDIS_PREFIX}rt:`) || k.includes(g.user.id));
    expect(mine.length).toBeGreaterThanOrEqual(3);
    for (const key of keys) {
      expect(key).not.toContain(g.pair.refreshToken);
      expect(key).not.toContain(second.refreshToken);
      const ttl = await probe.ttl(key);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(CFG.refreshTtlSec);
      const type = await probe.type(key);
      if (type === 'hash') {
        const values = Object.values(await probe.hgetall(key)).join('|');
        expect(values).not.toContain(g.pair.refreshToken);
        expect(values).not.toContain(second.refreshToken);
      }
    }
    // reuso: revoga a família e o access vigente (lastJti)
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.authenticateAccess(second.accessToken)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
    await expect(auth.refresh(second.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await store.close();
  });

  it('concorrência real: 30 refresh simultâneos do mesmo token, exatamente um vence', async () => {
    const store = new RedisTokenStore(URL);
    const repos = createMemoryRepositories();
    const auth = new AuthService(repos.users, store, CFG);
    const g = await auth.createGuest();
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () => auth.refresh(g.pair.refreshToken)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    await store.close();
  });

  it('jti revogado tem TTL', async () => {
    const store = new RedisTokenStore(URL);
    const jti = randomUUID();
    await store.revokeJti(jti, 30);
    const ttl = await probe.ttl(`${REDIS_PREFIX}jti:revoked:${jti}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
    await store.close();
  });
});
