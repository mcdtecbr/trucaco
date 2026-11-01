import { randomUUID } from 'node:crypto';
import {
  InvalidInputError,
  MATCH_PAGE_DEFAULT,
  MATCH_PAGE_MAX,
  NicknameTakenError,
  ProviderSubjectTakenError,
  type AuthProviderId,
  type FinishedMatchInput,
  type JsonObject,
  type MatchPage,
  type MatchRepository,
  type MatchSummary,
  type NewGuestInput,
  type NewReportInput,
  type PartnerCodesMap,
  type ReportRecord,
  type UserRecord,
  type UserRepository,
} from './types';
import {
  assertNickname,
  assertPartnerCodes,
  assertReportText,
  clampLimit,
  decodeCursor,
  encodeCursor,
  orderPair,
} from './validation';

/**
 * Implementações em memória para testes de sala (sem banco). Espelham as regras do SQL: apelido
 * único sem diferenciar caixa, par ordenado, sem auto-bloqueio, FK de usuário existente.
 * Compartilham o mesmo `MemoryStore` para que `listForUser` enxergue os apelidos.
 */
export class MemoryStore {
  readonly users = new Map<string, UserRecord>();
  readonly avatars = new Map<string, JsonObject>();
  readonly blocks = new Set<string>();
  readonly reports: ReportRecord[] = [];
  readonly partnerCodes = new Map<string, PartnerCodesMap>();
  readonly matches: StoredMatch[] = [];
}

interface StoredMatch {
  readonly id: string;
  readonly input: FinishedMatchInput;
}

const blockKey = (blocker: string, blocked: string): string => `${blocker}>${blocked}`;

export class MemoryUserRepository implements UserRepository {
  constructor(private readonly store: MemoryStore = new MemoryStore()) {}

  private requireUser(id: string): void {
    if (!this.store.users.has(id)) throw new InvalidInputError('Usuário inexistente.');
  }

  async createGuest(input: NewGuestInput): Promise<UserRecord> {
    assertNickname(input.nickname);
    const lower = input.nickname.toLowerCase();
    for (const user of this.store.users.values()) {
      if (user.nickname.toLowerCase() === lower) throw new NicknameTakenError();
      if (user.provider === 'guest' && user.providerSubject === input.providerSubject) {
        throw new ProviderSubjectTakenError();
      }
    }
    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      provider: 'guest',
      providerSubject: input.providerSubject,
      nickname: input.nickname,
      createdAt: now,
      lastSeenAt: now,
    };
    this.store.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.store.users.get(id) ?? null;
  }

  async findByProvider(
    provider: AuthProviderId,
    providerSubject: string,
  ): Promise<UserRecord | null> {
    for (const user of this.store.users.values()) {
      if (user.provider === provider && user.providerSubject === providerSubject) return user;
    }
    return null;
  }

  async touchLastSeen(id: string, at: Date): Promise<void> {
    const user = this.store.users.get(id);
    if (user !== undefined) this.store.users.set(id, { ...user, lastSeenAt: at });
  }

  async getAvatar(userId: string): Promise<JsonObject | null> {
    return this.store.avatars.get(userId) ?? null;
  }

  async saveAvatar(userId: string, parts: JsonObject): Promise<void> {
    this.requireUser(userId);
    this.store.avatars.set(userId, parts);
  }

  async addBlock(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new InvalidInputError('Não é possível bloquear a si mesmo.');
    this.requireUser(blockerId);
    this.requireUser(blockedId);
    this.store.blocks.add(blockKey(blockerId, blockedId));
  }

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    this.store.blocks.delete(blockKey(blockerId, blockedId));
  }

  async listBlockedIds(userId: string): Promise<readonly string[]> {
    const prefix = `${userId}>`;
    return [...this.store.blocks]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  async listBlockerIds(userId: string): Promise<readonly string[]> {
    const suffix = `>${userId}`;
    return [...this.store.blocks]
      .filter((k) => k.endsWith(suffix))
      .map((k) => k.slice(0, k.length - suffix.length));
  }

  async createReport(input: NewReportInput): Promise<ReportRecord> {
    assertReportText(input.text);
    if (input.reporterId === input.reportedId) {
      throw new InvalidInputError('Não é possível denunciar a si mesmo.');
    }
    this.requireUser(input.reporterId);
    this.requireUser(input.reportedId);
    if (input.matchId !== undefined && !this.store.matches.some((m) => m.id === input.matchId)) {
      throw new InvalidInputError('Usuário ou partida inexistente.');
    }
    const report: ReportRecord = {
      id: randomUUID(),
      reporterId: input.reporterId,
      reportedId: input.reportedId,
      matchId: input.matchId ?? null,
      reason: input.reason,
      text: input.text ?? null,
      status: 'open',
      createdAt: new Date(),
    };
    this.store.reports.push(report);
    return report;
  }

  async getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null> {
    const [a, b] = orderPair(userId, partnerId);
    return this.store.partnerCodes.get(`${a}|${b}`) ?? null;
  }

  async savePartnerCodes(userId: string, partnerId: string, codes: PartnerCodesMap): Promise<void> {
    assertPartnerCodes(codes);
    const [a, b] = orderPair(userId, partnerId);
    this.requireUser(a);
    this.requireUser(b);
    this.store.partnerCodes.set(`${a}|${b}`, { ...codes });
  }
}

export class MemoryMatchRepository implements MatchRepository {
  constructor(private readonly store: MemoryStore = new MemoryStore()) {}

  async saveMatch(input: FinishedMatchInput): Promise<string> {
    const id = randomUUID();
    this.store.matches.push({ id, input });
    return id;
  }

  async listForUser(
    userId: string,
    options?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MatchPage> {
    const limit = clampLimit(options?.limit, MATCH_PAGE_DEFAULT, MATCH_PAGE_MAX);
    const cursor = options?.cursor === undefined ? null : decodeCursor(options.cursor);
    const mine = this.store.matches
      .filter((m) => m.input.players.some((p) => p.userId === userId))
      .sort((x, y) => {
        const dt = y.input.endedAt.getTime() - x.input.endedAt.getTime();
        return dt !== 0 ? dt : x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
      })
      .filter(
        (m) =>
          cursor === null ||
          m.input.endedAt.getTime() < cursor.endedAt.getTime() ||
          (m.input.endedAt.getTime() === cursor.endedAt.getTime() && m.id < cursor.id),
      );
    const page = mine.slice(0, limit);
    const items: MatchSummary[] = page.map(({ id, input }) => ({
      id,
      variant: input.variant,
      format: input.format,
      ironHand: input.ironHand,
      visibility: input.visibility,
      status: input.status,
      winnerTeam: input.winnerTeam,
      games: input.games,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      players: [...input.players]
        .sort((p, q) => p.seat - q.seat)
        .map((p) => ({
          seat: p.seat,
          team: p.team,
          userId: p.userId !== null && this.store.users.has(p.userId) ? p.userId : null,
          nickname: p.userId === null ? null : (this.store.users.get(p.userId)?.nickname ?? null),
          botFrom: p.botFrom,
        })),
    }));
    const last = page[page.length - 1];
    const nextCursor =
      mine.length > limit && last !== undefined
        ? encodeCursor({ endedAt: last.input.endedAt, id: last.id })
        : null;
    return { items, nextCursor };
  }
}

export function createMemoryRepositories(): {
  readonly store: MemoryStore;
  readonly users: MemoryUserRepository;
  readonly matches: MemoryMatchRepository;
} {
  const store = new MemoryStore();
  return {
    store,
    users: new MemoryUserRepository(store),
    matches: new MemoryMatchRepository(store),
  };
}
