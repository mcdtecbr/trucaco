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

describe('RedisTokenStore: claimIdToken, revokeAllForUser com exceção e peekLive (Redis real)', () => {
  const hex = (): string => randomUUID().replaceAll('-', '').repeat(2);
  const mkFamily = (userId: string, ttlSec = 60) => ({
    familyId: randomUUID(),
    userId,
    refreshHash: hex(),
    jti: randomUUID(),
    ttlSec,
  });

  it('claimIdToken grava só a chave idtoken:used:<key> com TTL arredondado para cima e mínimo de 1 s', async () => {
    const store = new RedisTokenStore(URL);
    const key = hex();
    expect(await store.claimIdToken(key, 30.2)).toBe(true);
    const redisKey = `${REDIS_PREFIX}idtoken:used:${key}`;
    expect(await probe.ttl(redisKey)).toBeGreaterThan(29);
    expect(await probe.ttl(redisKey)).toBeLessThanOrEqual(31);
    // A segunda tentativa não renova o TTL (NX).
    expect(await store.claimIdToken(key, 3000)).toBe(false);
    expect(await probe.ttl(redisKey)).toBeLessThanOrEqual(31);
    // TTL nulo ou negativo não cria chave sem expiração.
    const zero = hex();
    expect(await store.claimIdToken(zero, 0)).toBe(true);
    expect(await probe.ttl(`${REDIS_PREFIX}idtoken:used:${zero}`)).toBeGreaterThan(0);
    await store.close();
  });

  it('claimIdToken: duas instâncias do store disputando a mesma chave, só uma vence', async () => {
    const a = new RedisTokenStore(URL);
    const b = new RedisTokenStore(URL);
    const key = hex();
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => a.claimIdToken(key, 60)),
      ...Array.from({ length: 10 }, () => b.claimIdToken(key, 60)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await a.close();
    await b.close();
  });

  it('revokeAllForUser(exceptFamilyId) poupa a família indicada (sem revokedAt, ainda no userfam) e revoga as outras', async () => {
    const store = new RedisTokenStore(URL);
    const userId = randomUUID();
    const keep = mkFamily(userId);
    const other1 = mkFamily(userId);
    const other2 = mkFamily(userId);
    const stranger = mkFamily(randomUUID());
    for (const f of [keep, other1, other2, stranger]) await store.createFamily(f);

    const jtis = await store.revokeAllForUser(userId, keep.familyId);
    expect(jtis.sort()).toEqual([other1.jti, other2.jti].sort());

    const revoked = async (familyId: string): Promise<boolean> =>
      (await probe.hexists(`${REDIS_PREFIX}rtfam:${familyId}`, 'revokedAt')) === 1;
    expect(await revoked(keep.familyId)).toBe(false);
    expect(await revoked(other1.familyId)).toBe(true);
    expect(await revoked(other2.familyId)).toBe(true);
    expect(await revoked(stranger.familyId)).toBe(false);
    expect(await probe.sismember(`${REDIS_PREFIX}userfam:${userId}`, keep.familyId)).toBe(1);

    expect(await store.peekLive(keep.refreshHash)).toEqual({ userId, familyId: keep.familyId });
    expect(await store.peekLive(other1.refreshHash)).toBeNull();
    // Segunda chamada com a mesma exceção: nada novo a revogar.
    expect(await store.revokeAllForUser(userId, keep.familyId)).toEqual([]);
    await store.close();
  });

  it('revokeAllForUser com exceção desconhecida revoga tudo do usuário', async () => {
    const store = new RedisTokenStore(URL);
    const userId = randomUUID();
    const a = mkFamily(userId);
    const b = mkFamily(userId);
    await store.createFamily(a);
    await store.createFamily(b);
    expect((await store.revokeAllForUser(userId, randomUUID())).sort()).toEqual(
      [a.jti, b.jti].sort(),
    );
    expect(await store.peekLive(a.refreshHash)).toBeNull();
    expect(await store.peekLive(b.refreshHash)).toBeNull();
    await store.close();
  });

  it('peekLive não consome o token: nenhum usedAt é gravado e o token ainda rotaciona depois', async () => {
    const store = new RedisTokenStore(URL);
    const f = mkFamily(randomUUID());
    await store.createFamily(f);
    for (let i = 0; i < 3; i++) {
      expect(await store.peekLive(f.refreshHash)).toEqual({
        userId: f.userId,
        familyId: f.familyId,
      });
    }
    expect(await probe.hexists(`${REDIS_PREFIX}rt:${f.refreshHash}`, 'usedAt')).toBe(0);
    const rotated = await store.rotate({
      refreshHash: f.refreshHash,
      newRefreshHash: hex(),
      newJti: randomUUID(),
      ttlSec: 60,
      graceSec: 0,
      familyMaxSec: 3600,
    });
    expect(rotated.status).toBe('rotated');
    // Depois de rotacionado (usado), peekLive devolve null.
    expect(await store.peekLive(f.refreshHash)).toBeNull();
    await store.close();
  });

  it('peekLive devolve null quando a família expirou ou foi apagada, mesmo com o token ainda no Redis', async () => {
    const store = new RedisTokenStore(URL);
    const f = mkFamily(randomUUID());
    await store.createFamily(f);
    await probe.del(`${REDIS_PREFIX}rtfam:${f.familyId}`);
    expect(await probe.exists(`${REDIS_PREFIX}rt:${f.refreshHash}`)).toBe(1);
    expect(await store.peekLive(f.refreshHash)).toBeNull();
    // Hash desconhecido e hash revogado por revokeFamily.
    expect(await store.peekLive(hex())).toBeNull();
    const g = mkFamily(randomUUID());
    await store.createFamily(g);
    await store.revokeFamily(g.familyId);
    expect(await store.peekLive(g.refreshHash)).toBeNull();
    await store.close();
  });
});

describe('RedisTokenStore: nonce do login social (Redis real)', () => {
  const hex = (): string => randomUUID().replaceAll('-', '').repeat(2);

  it('grava só nonce:<hash> com o TTL pedido, consome com DEL e nunca renova', async () => {
    const store = new RedisTokenStore(URL);
    const key = hex();
    await store.putNonce(key, 300);
    const redisKey = `${REDIS_PREFIX}nonce:${key}`;
    const ttl = await probe.ttl(redisKey);
    expect(ttl).toBeGreaterThan(295);
    expect(ttl).toBeLessThanOrEqual(300);
    expect(await store.consumeNonce(key)).toBe(true);
    expect(await probe.exists(redisKey)).toBe(0);
    expect(await store.consumeNonce(key)).toBe(false);
    await store.close();
  });

  it('o AuthService emite nonce cujo Redis guarda só o SHA-256 (nunca o valor em claro)', async () => {
    const store = new RedisTokenStore(URL);
    const auth = new AuthService(createMemoryRepositories().users, store, {
      secret: new TextEncoder().encode('segredo-de-teste-com-32-bytes-ou-mais!!'),
      issuer: 'trucaco',
      audience: 'trucaco-api',
      accessTtlSec: 900,
      refreshTtlSec: 120,
      refreshReuseGraceSec: 0,
      refreshFamilyMaxSec: 7_776_000,
      clockToleranceSec: 5,
    });
    const { nonce, expiresIn } = await auth.issueNonce();
    expect(expiresIn).toBe(300);
    for (const key of await probe.keys(`${REDIS_PREFIX}nonce:*`)) expect(key).not.toContain(nonce);
    await store.close();
  });

  it('duas instâncias disputando o mesmo nonce: só uma consome', async () => {
    const a = new RedisTokenStore(URL);
    const b = new RedisTokenStore(URL);
    const key = hex();
    await a.putNonce(key, 60);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, () => a.consumeNonce(key)),
      ...Array.from({ length: 10 }, () => b.consumeNonce(key)),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await a.close();
    await b.close();
  });
});
