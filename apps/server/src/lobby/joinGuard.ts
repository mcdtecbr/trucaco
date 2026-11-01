import { DEFAULT_MAX_KEYS, SlidingWindowLimiter } from '../rateLimit';

export interface JoinGuardConfig {
  /** Tentativas de entrar por código por usuário/min (qualquer resultado). */
  readonly attemptsPerUserPerMin: number;
  /** Tentativas por IP/min. */
  readonly attemptsPerIpPerMin: number;
  /** Falhas por usuário na janela que disparam o bloqueio temporário. */
  readonly failLockThreshold: number;
  /** Falhas por IP na janela (acima disso o IP é limitado). */
  readonly failsPerIp: number;
  /** Janela de contagem das falhas. */
  readonly failWindowMs: number;
  /** Duração do bloqueio do usuário. */
  readonly lockMs: number;
}

export const DEFAULT_JOIN_GUARD: JoinGuardConfig = {
  attemptsPerUserPerMin: 10,
  attemptsPerIpPerMin: 30,
  failLockThreshold: 6,
  failsPerIp: 20,
  failWindowMs: 10 * 60_000,
  lockMs: 10 * 60_000,
};

export type GuardVerdict = 'ok' | 'limited' | 'locked';

/**
 * Freio de tentativas de entrar por código (anti força bruta e anti oráculo de existência). Memória do
 * processo, com teto de chaves (`SlidingWindowLimiter`): com várias instâncias o limite efetivo multiplica;
 * a migração para Redis (chaves `rl:`) fica para o deploy multi-instância.
 *
 * Por IP E por usuário: toda tentativa conta; falha conta à parte (janela longa). `failLockThreshold`
 * falhas do usuário bloqueiam o usuário por `lockMs` (mesmo se trocar de IP). Sucesso não zera a contagem
 * de falhas (impede alternar acertos e chutes).
 */
export class JoinGuard {
  private readonly userAttempts: SlidingWindowLimiter;
  private readonly ipAttempts: SlidingWindowLimiter;
  private readonly userFails: SlidingWindowLimiter;
  private readonly ipFails: SlidingWindowLimiter;
  private readonly locks = new Map<string, number>();

  constructor(
    private readonly cfg: JoinGuardConfig = DEFAULT_JOIN_GUARD,
    private readonly maxKeys: number = DEFAULT_MAX_KEYS,
  ) {
    this.userAttempts = new SlidingWindowLimiter(cfg.attemptsPerUserPerMin, 60_000, maxKeys);
    this.ipAttempts = new SlidingWindowLimiter(cfg.attemptsPerIpPerMin, 60_000, maxKeys);
    // Só `record`/`count`: o teto vem de `cfg`, não do limitador.
    this.userFails = new SlidingWindowLimiter(Number.MAX_SAFE_INTEGER, cfg.failWindowMs, maxKeys);
    this.ipFails = new SlidingWindowLimiter(Number.MAX_SAFE_INTEGER, cfg.failWindowMs, maxKeys);
  }

  /** Chamar ANTES de qualquer consulta de código. `ok` consome uma tentativa. */
  check(userId: string, ip: string, now: number = Date.now()): GuardVerdict {
    const until = this.locks.get(userId);
    if (until !== undefined) {
      if (until > now) return 'locked';
      this.locks.delete(userId);
    }
    if (this.ipFails.count(ip, now) >= this.cfg.failsPerIp) return 'limited';
    // `allow` conta só quando passa; as duas janelas são consultadas antes de gastar qualquer uma.
    if (!this.userAttempts.allow(userId, now)) return 'limited';
    if (!this.ipAttempts.allow(ip, now)) return 'limited';
    return 'ok';
  }

  /** Falha (código inexistente, mesa cheia, em partida, de outro tipo...). Pode bloquear o usuário. */
  fail(userId: string, ip: string, now: number = Date.now()): void {
    this.userFails.record(userId, now);
    this.ipFails.record(ip, now);
    if (this.userFails.count(userId, now) >= this.cfg.failLockThreshold) {
      this.locks.delete(userId);
      this.locks.set(userId, now + this.cfg.lockMs);
      if (this.locks.size > this.maxKeys) {
        const oldest = this.locks.keys().next();
        if (oldest.done !== true) this.locks.delete(oldest.value);
      }
    }
  }

  isLocked(userId: string, now: number = Date.now()): boolean {
    return (this.locks.get(userId) ?? 0) > now;
  }
}
