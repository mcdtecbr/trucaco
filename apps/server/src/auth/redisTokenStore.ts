/**
 * `TokenStore` em Redis (ioredis). Chaves e TTLs: docs/banco-de-dados.md, seção 2, prefixo
 * `trucaco:v1:`. A rotação é UM script Lua (checagem da família + `HSETNX usedAt` + gravação do novo
 * token + `lastJti` + TTLs) para que logout/reuso concorrentes não deixem emitir token novo de família
 * revogada. Nunca registra hash, token nem a URL (pode ter senha).
 */
import { Redis } from 'ioredis';
import { log } from '../logger';
import {
  TokenStoreUnavailableError,
  type CreateFamilyInput,
  type RotateInput,
  type RotateResult,
  type TokenStore,
} from './tokenStore';

export const REDIS_PREFIX = 'trucaco:v1:';

const ROTATE_LUA = `
local old = KEYS[1]
local new = KEYS[2]
local prefix = ARGV[1]
local now = ARGV[2]
local nowN = tonumber(now)
local ttl = tonumber(ARGV[3])
local newJti = ARGV[4]
local graceMs = tonumber(ARGV[5])
local maxSec = tonumber(ARGV[6])
local fid = redis.call('HGET', old, 'familyId')
if not fid then return {'unknown'} end
local userId = redis.call('HGET', old, 'userId')
local fam = prefix .. 'rtfam:' .. fid
if redis.call('EXISTS', fam) == 0 then return {'unknown'} end
if redis.call('HEXISTS', fam, 'revokedAt') == 1 then return {'revoked', userId, fid} end
local created = tonumber(redis.call('HGET', fam, 'createdAt')) or nowN
local remaining = maxSec - math.floor((nowN - created) / 1000)
if remaining <= 0 then return {'unknown'} end
if remaining < ttl then ttl = remaining end
local graced = ''
if redis.call('HSETNX', old, 'usedAt', now) == 0 then
  local usedAt = tonumber(redis.call('HGET', old, 'usedAt')) or 0
  if graceMs > 0 and (nowN - usedAt) <= graceMs and redis.call('HSETNX', old, 'graceUsed', '1') == 1 then
    graced = '1'
  else
    redis.call('HSET', fam, 'revokedAt', now)
    local last = redis.call('HGET', fam, 'lastJti')
    if not last then last = '' end
    return {'reuse', userId, fid, last}
  end
end
redis.call('HSET', new, 'userId', userId, 'familyId', fid, 'issuedAt', now)
redis.call('EXPIRE', new, ttl)
redis.call('HSET', fam, 'lastJti', newJti)
redis.call('EXPIRE', fam, ttl)
return {'rotated', userId, fid, graced, tostring(ttl)}
`;

const REVOKE_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 and redis.call('HEXISTS', KEYS[1], 'revokedAt') == 0 then
  redis.call('HSET', KEYS[1], 'revokedAt', ARGV[1])
end
return 1
`;

type RotateCommand = (
  oldKey: string,
  newKey: string,
  prefix: string,
  now: string,
  ttl: number,
  newJti: string,
  graceMs: number,
  maxSec: number,
) => Promise<string[]>;

interface RedisWithScripts {
  trucacoRotate: RotateCommand;
  trucacoRevoke: (key: string, now: string) => Promise<number>;
}

export class RedisTokenStore implements TokenStore {
  private readonly redis: Redis;
  private readonly scripts: RedisWithScripts;

  constructor(
    url: string,
    private readonly now: () => number = Date.now,
  ) {
    this.redis = new Redis(url, {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      // Redis fora do ar vira erro (503) após poucas tentativas/3 s, não requisição pendurada.
      commandTimeout: 3000,
    });
    // Sem listener o `error` do ioredis derruba o processo. Só o nome/código: a mensagem pode ter host.
    this.redis.on('error', (err: Error & { code?: string }) => {
      log.error('redis: erro de conexão', { name: err.name, code: err.code ?? null });
    });
    this.redis.defineCommand('trucacoRotate', { numberOfKeys: 2, lua: ROTATE_LUA });
    this.redis.defineCommand('trucacoRevoke', { numberOfKeys: 1, lua: REVOKE_LUA });
    this.scripts = this.redis as unknown as RedisWithScripts;
  }

  /** Aguarda a conexão (usado no boot para falhar cedo e nos testes de integração). */
  async ping(): Promise<void> {
    await this.redis.ping();
  }

  /** Qualquer falha do ioredis (conexão, timeout, resposta de erro) vira `TokenStoreUnavailableError`. */
  private async run<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      log.error('redis: comando falhou', { name: err instanceof Error ? err.name : 'unknown' });
      throw new TokenStoreUnavailableError();
    }
  }

  async createFamily(input: CreateFamilyInput): Promise<void> {
    await this.run(async () => {
      const nowMs = String(this.now());
      const fam = `${REDIS_PREFIX}rtfam:${input.familyId}`;
      const rt = `${REDIS_PREFIX}rt:${input.refreshHash}`;
      const userfam = `${REDIS_PREFIX}userfam:${input.userId}`;
      const result = await this.redis
        .multi()
        .hset(rt, { userId: input.userId, familyId: input.familyId, issuedAt: nowMs })
        .expire(rt, input.ttlSec)
        .hset(fam, { userId: input.userId, createdAt: nowMs, lastJti: input.jti })
        .expire(fam, input.ttlSec)
        .sadd(userfam, input.familyId)
        .expire(userfam, input.ttlSec)
        .exec();
      if (result === null || result.some(([err]) => err !== null)) {
        throw new Error('redis: createFamily falhou');
      }
      await this.pruneUserFamilies(input.userId);
    });
  }

  /** Remove de `userfam:<id>` as famílias cujo `rtfam` expirou (o conjunto não cresce sem limite). */
  private async pruneUserFamilies(userId: string): Promise<void> {
    const key = `${REDIS_PREFIX}userfam:${userId}`;
    const ids = await this.redis.smembers(key);
    if (ids.length === 0) return;
    const checks = this.redis.pipeline();
    for (const id of ids) checks.exists(`${REDIS_PREFIX}rtfam:${id}`);
    const res = (await checks.exec()) ?? [];
    const dead = ids.filter((_, i) => res[i]?.[1] === 0);
    if (dead.length > 0) await this.redis.srem(key, ...dead);
  }

  async lookup(refreshHash: string): Promise<{ userId: string; familyId: string } | null> {
    return this.run(async () => {
      const [userId, familyId] = await this.redis.hmget(
        `${REDIS_PREFIX}rt:${refreshHash}`,
        'userId',
        'familyId',
      );
      return userId !== null && userId !== undefined && familyId !== null && familyId !== undefined
        ? { userId, familyId }
        : null;
    });
  }

  async rotate(input: RotateInput): Promise<RotateResult> {
    return this.run(async () => {
      const reply = await this.scripts.trucacoRotate(
        `${REDIS_PREFIX}rt:${input.refreshHash}`,
        `${REDIS_PREFIX}rt:${input.newRefreshHash}`,
        REDIS_PREFIX,
        String(this.now()),
        input.ttlSec,
        input.newJti,
        input.graceSec * 1000,
        input.familyMaxSec,
      );
      const [status, userId, familyId, extra, ttl] = reply;
      if (status === 'rotated' && userId !== undefined && familyId !== undefined) {
        // Fora do Lua (Cluster-safe, sem chave não declarada): `GT` nunca encurta o TTL do conjunto.
        await this.redis.expire(`${REDIS_PREFIX}userfam:${userId}`, Number(ttl), 'GT');
        return extra === '1'
          ? { status, userId, familyId, graced: true }
          : { status, userId, familyId };
      }
      if (status === 'revoked' && userId !== undefined && familyId !== undefined) {
        return { status, userId, familyId };
      }
      if (status === 'reuse' && userId !== undefined && familyId !== undefined) {
        return {
          status,
          userId,
          familyId,
          lastJti: extra === undefined || extra === '' ? null : extra,
        };
      }
      return { status: 'unknown' };
    });
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.run(async () => {
      await this.scripts.trucacoRevoke(`${REDIS_PREFIX}rtfam:${familyId}`, String(this.now()));
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.run(async () => {
      const ids = await this.redis.smembers(`${REDIS_PREFIX}userfam:${userId}`);
      for (const id of ids) {
        await this.scripts.trucacoRevoke(`${REDIS_PREFIX}rtfam:${id}`, String(this.now()));
      }
      await this.pruneUserFamilies(userId);
    });
  }

  async revokeJti(jti: string, ttlSec: number): Promise<void> {
    await this.run(() =>
      this.redis.set(`${REDIS_PREFIX}jti:revoked:${jti}`, '1', 'EX', Math.max(1, ttlSec)),
    );
  }

  async isJtiRevoked(jti: string): Promise<boolean> {
    return this.run(
      async () => (await this.redis.exists(`${REDIS_PREFIX}jti:revoked:${jti}`)) === 1,
    );
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
