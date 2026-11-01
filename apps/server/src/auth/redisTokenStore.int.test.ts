/**
 * Integração com Redis REAL (`pnpm test:int`, só com `TEST_REDIS_URL`: host local e DB lógico != 0).
 * Roda a mesma bateria de contrato da memória e confere o formato das chaves (docs/banco-de-dados.md).
 */
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db';
import { AuthService } from './authService';
import { TokenStoreUnavailableError } from './tokenStore';
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

tokenStoreContract('Redis', (clock) => new RedisTokenStore(URL, clock));

describe('RedisTokenStore: chaves e TTL', () => {
  const CFG = {
    secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
    issuer: 'trucaco',
    audience: 'trucaco-api',
    accessTtlSec: 900,
    refreshTtlSec: 120,
    refreshReuseGraceSec: 20,
    refreshFamilyMaxSec: 7_776_000,
    clockToleranceSec: 5,
  };

  it('só hash no Redis, todo valor com TTL, lastJti atualizado e reuso revoga o access vigente', async () => {
    const store = new RedisTokenStore(URL);
    const repos = createMemoryRepositories();
    const auth = new AuthService(repos.users, store, { ...CFG, refreshReuseGraceSec: 0 });
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
    const auth = new AuthService(repos.users, store, { ...CFG, refreshReuseGraceSec: 0 });
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

describe('RedisTokenStore: userfam, graça e indisponibilidade', () => {
  const CFG2 = {
    secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
    issuer: 'trucaco',
    audience: 'trucaco-api',
    accessTtlSec: 900,
    refreshTtlSec: 120,
    refreshReuseGraceSec: 20,
    refreshFamilyMaxSec: 7_776_000,
    clockToleranceSec: 5,
  };

  it('userfam descarta famílias cujo rtfam expirou (createFamily e revokeAllForUser)', async () => {
    const store = new RedisTokenStore(URL);
    const userId = randomUUID();
    const mk = (familyId: string, ttlSec: number) => ({
      familyId,
      userId,
      refreshHash: randomUUID().replaceAll('-', '').repeat(2),
      jti: randomUUID(),
      ttlSec,
    });
    const userfam = `${REDIS_PREFIX}userfam:${userId}`;
    const short = mk(randomUUID(), 1);
    await store.createFamily(short);
    await store.createFamily(mk(randomUUID(), 60));
    expect(await probe.scard(userfam)).toBe(2);
    await new Promise((r) => setTimeout(r, 1300));
    const keep = mk(randomUUID(), 60);
    await store.createFamily(keep); // poda a expirada
    expect(await probe.smembers(userfam)).not.toContain(short.familyId);
    expect(await probe.scard(userfam)).toBe(2);
    // revokeAll também poda
    await store.revokeAllForUser(userId);
    expect(await probe.ttl(userfam)).toBeGreaterThan(0);
    await store.close();
  });

  it('rotação não encurta o TTL do userfam e o token em claro nunca está no Redis (graça)', async () => {
    const store = new RedisTokenStore(URL);
    const auth = new AuthService(createMemoryRepositories().users, store, CFG2);
    const g = await auth.createGuest();
    const first = await auth.refresh(g.pair.refreshToken);
    const graced = await auth.refresh(g.pair.refreshToken); // janela de graça: sucessor irmão
    expect(graced.refreshToken).not.toBe(first.refreshToken);
    for (const key of await probe.keys(`${REDIS_PREFIX}*`)) {
      for (const secret of [g.pair.refreshToken, first.refreshToken, graced.refreshToken]) {
        expect(key).not.toContain(secret);
        if ((await probe.type(key)) === 'hash') {
          expect(Object.values(await probe.hgetall(key)).join('|')).not.toContain(secret);
        }
      }
    }
    // 3ª reapresentação: reuso, família revogada
    await expect(auth.refresh(g.pair.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await expect(auth.refresh(graced.refreshToken)).rejects.toMatchObject({
      code: 'INVALID_REFRESH_TOKEN',
    });
    await store.close();
  });

  it('Redis inalcançável: TokenStoreUnavailableError (vira 503), não erro cru', async () => {
    const dead = new RedisTokenStore('redis://127.0.0.1:1/15');
    await expect(dead.isJtiRevoked(randomUUID())).rejects.toBeInstanceOf(
      TokenStoreUnavailableError,
    );
    await expect(dead.lookup('a'.repeat(64))).rejects.toBeInstanceOf(TokenStoreUnavailableError);
    await dead.close();
  });
});
