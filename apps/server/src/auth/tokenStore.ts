/**
 * Armazenamento dos refresh tokens (rotativos, com detecção de reuso). Só o HASH (SHA-256 em hex)
 * do token opaco entra aqui; o token em claro nunca é armazenado. Implementações: memória (testes de
 * sala e dev sem Redis) e Redis (`RedisTokenStore`, chaves `trucaco:v1:` de docs/banco-de-dados.md).
 * Semântica idêntica nas duas (testada pela mesma bateria).
 */

export type RotateResult =
  | { readonly status: 'rotated'; readonly userId: string; readonly familyId: string }
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
}

export interface TokenStore {
  createFamily(input: CreateFamilyInput): Promise<void>;
  /** ATÔMICO: dois `rotate` com o mesmo hash nunca produzem dois `rotated`. */
  rotate(input: RotateInput): Promise<RotateResult>;
  revokeFamily(familyId: string): Promise<void>;
  /** "Sair de todos os aparelhos", banimento, remoção de conta. */
  revokeAllForUser(userId: string): Promise<void>;
  /** Revoga um access JWT até o instante em que ele expiraria. */
  revokeJti(jti: string, ttlSec: number): Promise<void>;
  isJtiRevoked(jti: string): Promise<boolean>;
  close(): Promise<void>;
}

interface FamilyEntry {
  userId: string;
  lastJti: string;
  revokedAt: number | null;
  expiresAt: number;
}

interface TokenEntry {
  userId: string;
  familyId: string;
  usedAt: number | null;
  expiresAt: number;
}

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly families = new Map<string, FamilyEntry>();
  private readonly revokedJtis = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async createFamily(input: CreateFamilyInput): Promise<void> {
    const expiresAt = this.now() + input.ttlSec * 1000;
    this.families.set(input.familyId, {
      userId: input.userId,
      lastJti: input.jti,
      revokedAt: null,
      expiresAt,
    });
    this.tokens.set(input.refreshHash, {
      userId: input.userId,
      familyId: input.familyId,
      usedAt: null,
      expiresAt,
    });
  }

  async rotate(input: RotateInput): Promise<RotateResult> {
    const now = this.now();
    const token = this.tokens.get(input.refreshHash);
    if (token === undefined || token.expiresAt <= now) return { status: 'unknown' };
    const family = this.families.get(token.familyId);
    if (family === undefined || family.expiresAt <= now) return { status: 'unknown' };
    const { userId, familyId } = token;
    if (family.revokedAt !== null) return { status: 'revoked', userId, familyId };
    if (token.usedAt !== null) {
      family.revokedAt = now;
      return { status: 'reuse', userId, familyId, lastJti: family.lastJti };
    }
    token.usedAt = now;
    const expiresAt = now + input.ttlSec * 1000;
    this.tokens.set(input.newRefreshHash, { userId, familyId, usedAt: null, expiresAt });
    family.lastJti = input.newJti;
    family.expiresAt = expiresAt;
    return { status: 'rotated', userId, familyId };
  }

  async revokeFamily(familyId: string): Promise<void> {
    const family = this.families.get(familyId);
    if (family !== undefined && family.revokedAt === null) family.revokedAt = this.now();
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const family of this.families.values()) {
      if (family.userId === userId && family.revokedAt === null) family.revokedAt = this.now();
    }
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

  async close(): Promise<void> {
    this.tokens.clear();
    this.families.clear();
    this.revokedJtis.clear();
  }
}
