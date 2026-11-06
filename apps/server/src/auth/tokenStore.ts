/**
 * Armazenamento dos refresh tokens (rotativos, com detecção de reuso). Só o HASH (SHA-256 em hex)
 * do token opaco entra aqui; o token em claro nunca é armazenado. Implementações: memória (testes de
 * sala e dev sem Redis) e Redis (`RedisTokenStore`, chaves `trucaco:v1:` de docs/banco-de-dados.md).
 * Semântica idêntica nas duas (testada pela mesma bateria).
 */

/**
 * O armazenamento está fora do ar (Redis sem conexão, timeout de comando, resposta de erro). Mapeada
 * para 503 (REST e `onAuth` da sala), nunca 401/500. Sem mensagem do erro original (pode ter host).
 */
export class TokenStoreUnavailableError extends Error {
  constructor() {
    super('token store indisponível');
    this.name = 'TokenStoreUnavailableError';
  }
}

export type RotateResult =
  | {
      readonly status: 'rotated';
      readonly userId: string;
      readonly familyId: string;
      /** `true` = reapresentação dentro da janela de graça (um sucessor irmão foi emitido). */
      readonly graced?: boolean;
    }
  /** Hash desconhecido, expirado ou de família expirada: sem efeito colateral. */
  | { readonly status: 'unknown' }
  /** Família já revogada (logout, banimento ou reuso anterior). */
  | { readonly status: 'revoked'; readonly userId: string; readonly familyId: string }
  /** Token já rotacionado reapresentado: a família foi revogada AGORA. */
  | {
      readonly status: 'reuse';
      readonly userId: string;
      readonly familyId: string;
      /** `jti` do último access emitido da família, para revogar. */
      readonly lastJti: string | null;
    };

export interface CreateFamilyInput {
  readonly familyId: string;
  readonly userId: string;
  readonly refreshHash: string;
  /** `jti` do primeiro access emitido. */
  readonly jti: string;
  readonly ttlSec: number;
}

export interface RotateInput {
  readonly refreshHash: string;
  readonly newRefreshHash: string;
  /** `jti` do novo access (vira `lastJti` da família). */
  readonly newJti: string;
  readonly ttlSec: number;
  /**
   * Janela de graça (s): reapresentar o token JÁ rotacionado dentro dela não é reuso; emite UM sucessor
   * irmão (o primeiro continua válido) e é a única vez. 0 = sem graça (qualquer reapresentação revoga).
   */
  readonly graceSec: number;
  /** Teto absoluto de vida da família desde a criação (s): a rotação não renova além dele. */
  readonly familyMaxSec: number;
}

export interface TokenStore {
  /** Dono e família de um refresh (sem efeito colateral). `null` = desconhecido/expirado. */
  lookup(refreshHash: string): Promise<{ userId: string; familyId: string } | null>;
  /**
   * Como `lookup`, mas só devolve o refresh VIVO e sem efeito colateral: desconhecido, expirado, já
   * rotacionado (usado) ou de família revogada/expirada dão `null`. Base da prova de acesso recente.
   */
  peekLive(refreshHash: string): Promise<{ userId: string; familyId: string } | null>;
  createFamily(input: CreateFamilyInput): Promise<void>;
  /** ATÔMICO: dois `rotate` com o mesmo hash nunca produzem dois `rotated`. */
  rotate(input: RotateInput): Promise<RotateResult>;
  /**
   * Revoga a família. Devolve o `lastJti` (último access emitido) se ela acabou de ser revogada AGORA;
   * `null` se já estava revogada, não existe ou expirou. Quem chama revoga esse `jti` (senão o access
   * vigente sobrevive até o TTL).
   */
  revokeFamily(familyId: string): Promise<string | null>;
  /** "Sair de todos os aparelhos", banimento, remoção de conta. Devolve o `lastJti` de cada família recém-revogada. */
  revokeAllForUser(userId: string, exceptFamilyId?: string): Promise<string[]>;
  /** Revoga um access JWT até o instante em que ele expiraria. */
  revokeJti(jti: string, ttlSec: number): Promise<void>;
  isJtiRevoked(jti: string): Promise<boolean>;
  /**
   * Uso único de um idToken social (`SET NX EX`): `true` na primeira chamada com a `key` (hash do token,
   * nunca o token), `false` enquanto o TTL não passar. ATÔMICO entre processos no Redis.
   */
  claimIdToken(key: string, ttlSec: number): Promise<boolean>;
  /** Registra um nonce de login social emitido por nós (`key` = hash do nonce) com validade de `ttlSec`. */
  putNonce(key: string, ttlSec: number): Promise<void>;
  /**
   * Consome o nonce: `true` UMA vez se foi emitido e não expirou; `false` se desconhecido, expirado ou já
   * consumido. ATÔMICO entre processos no Redis (`DEL`).
   */
  consumeNonce(key: string): Promise<boolean>;
  close(): Promise<void>;
}

interface FamilyEntry {
  userId: string;
  createdAt: number;
  lastJti: string;
  revokedAt: number | null;
  expiresAt: number;
}

interface TokenEntry {
  userId: string;
  familyId: string;
  usedAt: number | null;
  graceUsed: boolean;
  expiresAt: number;
}

/** Teto de idTokens consumidos guardados pelo `MemoryTokenStore`. */
export const MAX_CLAIMED_ID_TOKENS = 10_000;
/** Teto de nonces pendentes no `MemoryTokenStore` (o Redis aplica TTL sozinho). */
export const MAX_PENDING_NONCES = 10_000;

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly families = new Map<string, FamilyEntry>();
  private readonly revokedJtis = new Map<string, number>();
  private readonly claimedIdTokens = new Map<string, number>();
  private readonly nonces = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async createFamily(input: CreateFamilyInput): Promise<void> {
    const expiresAt = this.now() + input.ttlSec * 1000;
    this.families.set(input.familyId, {
      userId: input.userId,
      createdAt: this.now(),
      lastJti: input.jti,
      revokedAt: null,
      expiresAt,
    });
    this.tokens.set(input.refreshHash, {
      userId: input.userId,
      familyId: input.familyId,
      usedAt: null,
      graceUsed: false,
      expiresAt,
    });
  }

  async lookup(refreshHash: string): Promise<{ userId: string; familyId: string } | null> {
    const token = this.tokens.get(refreshHash);
    if (token === undefined || token.expiresAt <= this.now()) return null;
    return { userId: token.userId, familyId: token.familyId };
  }

  async peekLive(refreshHash: string): Promise<{ userId: string; familyId: string } | null> {
    const token = this.tokens.get(refreshHash);
    if (token === undefined || token.expiresAt <= this.now() || token.usedAt !== null) return null;
    const family = this.families.get(token.familyId);
    if (family === undefined || family.revokedAt !== null || family.expiresAt <= this.now()) {
      return null;
    }
    return { userId: token.userId, familyId: token.familyId };
  }

  async rotate(input: RotateInput): Promise<RotateResult> {
    const now = this.now();
    const token = this.tokens.get(input.refreshHash);
    if (token === undefined || token.expiresAt <= now) return { status: 'unknown' };
    const family = this.families.get(token.familyId);
    if (family === undefined || family.expiresAt <= now) return { status: 'unknown' };
    const { userId, familyId } = token;
    if (family.revokedAt !== null) return { status: 'revoked', userId, familyId };
    const remainingMs = family.createdAt + input.familyMaxSec * 1000 - now;
    if (remainingMs <= 0) return { status: 'unknown' };
    let graced = false;
    if (token.usedAt !== null) {
      if (input.graceSec > 0 && !token.graceUsed && now - token.usedAt <= input.graceSec * 1000) {
        token.graceUsed = true;
        graced = true;
      } else {
        family.revokedAt = now;
        return { status: 'reuse', userId, familyId, lastJti: family.lastJti };
      }
    } else {
      token.usedAt = now;
    }
    const expiresAt = now + Math.min(input.ttlSec * 1000, remainingMs);
    this.tokens.set(input.newRefreshHash, {
      userId,
      familyId,
      usedAt: null,
      graceUsed: false,
      expiresAt,
    });
    family.lastJti = input.newJti;
    family.expiresAt = Math.max(family.expiresAt, expiresAt);
    return graced
      ? { status: 'rotated', userId, familyId, graced: true }
      : { status: 'rotated', userId, familyId };
  }

  async revokeFamily(familyId: string): Promise<string | null> {
    const family = this.families.get(familyId);
    if (family === undefined || family.revokedAt !== null || family.expiresAt <= this.now()) {
      return null;
    }
    family.revokedAt = this.now();
    return family.lastJti;
  }

  async revokeAllForUser(userId: string, exceptFamilyId?: string): Promise<string[]> {
    const jtis: string[] = [];
    for (const [familyId, family] of this.families) {
      if (family.userId !== userId || familyId === exceptFamilyId) continue;
      const jti = await this.revokeFamily(familyId);
      if (jti !== null) jtis.push(jti);
    }
    return jtis;
  }

  async revokeJti(jti: string, ttlSec: number): Promise<void> {
    this.revokedJtis.set(jti, this.now() + ttlSec * 1000);
  }

  async isJtiRevoked(jti: string): Promise<boolean> {
    const until = this.revokedJtis.get(jti);
    if (until === undefined) return false;
    if (until <= this.now()) {
      this.revokedJtis.delete(jti);
      return false;
    }
    return true;
  }

  async claimIdToken(key: string, ttlSec: number): Promise<boolean> {
    const now = this.now();
    const until = this.claimedIdTokens.get(key);
    if (until !== undefined && until > now) return false;
    // Teto de memória (store de dev/teste): varre os vencidos e, se ainda estiver cheio, descarta os mais
    // antigos (ordem de inserção). Em produção o Redis aplica o TTL sozinho.
    if (this.claimedIdTokens.size >= MAX_CLAIMED_ID_TOKENS) {
      for (const [k, v] of this.claimedIdTokens) if (v <= now) this.claimedIdTokens.delete(k);
      for (const k of this.claimedIdTokens.keys()) {
        if (this.claimedIdTokens.size < MAX_CLAIMED_ID_TOKENS) break;
        this.claimedIdTokens.delete(k);
      }
    }
    this.claimedIdTokens.set(key, now + Math.max(1, ttlSec) * 1000);
    return true;
  }

  async putNonce(key: string, ttlSec: number): Promise<void> {
    const now = this.now();
    if (this.nonces.size >= MAX_PENDING_NONCES) {
      for (const [k, v] of this.nonces) if (v <= now) this.nonces.delete(k);
      for (const k of this.nonces.keys()) {
        if (this.nonces.size < MAX_PENDING_NONCES) break;
        this.nonces.delete(k);
      }
    }
    this.nonces.set(key, now + Math.max(1, ttlSec) * 1000);
  }

  async consumeNonce(key: string): Promise<boolean> {
    const until = this.nonces.get(key);
    if (until === undefined) return false;
    this.nonces.delete(key);
    return until > this.now();
  }

  async close(): Promise<void> {
    this.tokens.clear();
    this.families.clear();
    this.revokedJtis.clear();
    this.claimedIdTokens.clear();
    this.nonces.clear();
  }
}
