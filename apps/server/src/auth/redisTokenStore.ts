/**
 * `TokenStore` em Redis (ioredis). Chaves e TTLs: docs/banco-de-dados.md, seção 2, prefixo
 * `trucaco:v1:`. A rotação é UM script Lua (checagem da família + `HSETNX usedAt` + gravação do novo
 * token + `lastJti` + TTLs) para que logout/reuso concorrentes não deixem emitir token novo de família
 * revogada. Nunca registra hash, token nem a URL (pode ter senha).
 */
import { Redis } from 'ioredis';
import { log } from '../logger';
import type { CreateFamilyInput, RotateInput, RotateResult, TokenStore } from './tokenStore';

export const REDIS_PREFIX = 'trucaco:v1:';

const ROTATE_LUA = `
local old = KEYS[1]
local new = KEYS[2]
local prefix = ARGV[1]
local now = ARGV[2]
local ttl = tonumber(ARGV[3])
local newJti = ARGV[4]
local fid = redis.call('HGET', old, 'familyId')
if not fid then return {'unknown'} end
local userId = redis.call('HGET', old, 'userId')
local fam = prefix .. 'rtfam:' .. fid
if redis.call('EXISTS', fam) == 0 then return {'unknown'} end
if redis.call('HEXISTS', fam, 'revokedAt') == 1 then return {'revoked', userId, fid} end
if redis.call('HSETNX', old, 'usedAt', now) == 0 then
  redis.call('HSET', fam, 'revokedAt', now)
  local last = redis.call('HGET', fam, 'lastJti')
  if not last then last = '' end
  return {'reuse', userId, fid, last}
end
redis.call('HSET', new, 'userId', userId, 'familyId', fid, 'issuedAt', now)
redis.call('EXPIRE', new, ttl)
redis.call('HSET', fam, 'lastJti', newJti)
redis.call('EXPIRE', fam, ttl)
redis.call('EXPIRE', prefix .. 'userfam:' .. userId, ttl)
return {'rotated', userId, fid}
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

  async createFamily(input: CreateFamilyInput): Promise<void> {
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
  }

  async rotate(input: RotateInput): Promise<RotateResult> {
    const reply = await this.scripts.trucacoRotate(
      `${REDIS_PREFIX}rt:${input.refreshHash}`,
      `${REDIS_PREFIX}rt:${input.newRefreshHash}`,
      REDIS_PREFIX,
      String(this.now()),
      input.ttlSec,
      input.newJti,
    );
    const [status, userId, familyId, lastJti] = reply;
    if (status === 'rotated' && userId !== undefined && familyId !== undefined) {
      return { status, userId, familyId };
    }
    if (status === 'revoked' && userId !== undefined && familyId !== undefined) {
      return { status, userId, familyId };
    }
    if (status === 'reuse' && userId !== undefined && familyId !== undefined) {
      return {
        status,
        userId,
        familyId,
        lastJti: lastJti === undefined || lastJti === '' ? null : lastJti,
      };
    }
    return { status: 'unknown' };
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.scripts.trucacoRevoke(`${REDIS_PREFIX}rtfam:${familyId}`, String(this.now()));
  }

  async revokeAllForUser(userId: string): Promise<void> {
    const ids = await this.redis.smembers(`${REDIS_PREFIX}userfam:${userId}`);
    for (const id of ids) await this.revokeFamily(id);
  }

  async revokeJti(jti: string, ttlSec: number): Promise<void> {
    await this.redis.set(`${REDIS_PREFIX}jti:revoked:${jti}`, '1', 'EX', Math.max(1, ttlSec));
  }

  async isJtiRevoked(jti: string): Promise<boolean> {
    return (await this.redis.exists(`${REDIS_PREFIX}jti:revoked:${jti}`)) === 1;
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}
