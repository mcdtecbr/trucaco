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
  revokeAllForUser(userId: string): Promise<string[]>;
  /** Revoga um access JWT até o instante em que ele expiraria. */
  revokeJti(jti: string, ttlSec: number): Promise<void>;
  isJtiRevoked(jti: string): Promise<boolean>;
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

export class MemoryTokenStore implements TokenStore {
  private readonly tokens = new Map<string, TokenEntry>();
  private readonly families = new Map<string, FamilyEntry>();
  private readonly revokedJtis = new Map<string, number>();

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

  async revokeAllForUser(userId: string): Promise<string[]> {
    const jtis: string[] = [];
    for (const [familyId, family] of this.families) {
      if (family.userId !== userId) continue;
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

  async close(): Promise<void> {
    this.tokens.clear();
    this.families.clear();
    this.revokedJtis.clear();
  }
}
