import { parseAvatarParts } from '@trucaco/protocol';
import type { AvatarParts } from '@trucaco/protocol';
import { randomUUID } from 'node:crypto';
import {
  InvalidInputError,
  MATCH_PAGE_DEFAULT,
  MATCH_PAGE_MAX,
  NicknameTakenError,
  NotPartnersError,
  ProviderSubjectTakenError,
  type AuthProviderId,
  type FinishedMatchInput,
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
  assertAvatarParts,
  assertFinishedMatch,
  assertPartnerCodes,
  assertProviderSubject,
  assertReportText,
  clampLimit,
  decodeCursor,
  encodeCursor,
  normalizeId,
  orderPair,
  validateNickname,
} from './validation';

/**
 * Implementações em memória para testes de sala (sem banco). Espelham as regras do SQL: apelido
 * único sem diferenciar caixa, par ordenado, sem auto-bloqueio, FK de usuário existente.
 * Compartilham o mesmo `MemoryStore` para que `listForUser` enxergue os apelidos.
 */
export class MemoryStore {
  readonly users = new Map<string, UserRecord>();
  readonly avatars = new Map<string, unknown>();
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
    const nickname = validateNickname(input.nickname);
    assertProviderSubject(input.providerSubject);
    const lower = nickname.toLowerCase();
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
      nickname,
      createdAt: now,
      lastSeenAt: now,
    };
    this.store.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.store.users.get(normalizeId(id)) ?? null;
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

  async touchLastSeen(rawId: string, at: Date): Promise<void> {
    const id = normalizeId(rawId);
    const user = this.store.users.get(id);
    if (user !== undefined) this.store.users.set(id, { ...user, lastSeenAt: at });
  }

  async updateNickname(rawId: string, rawNickname: string): Promise<void> {
    const id = normalizeId(rawId);
    const nickname = validateNickname(rawNickname);
    const user = this.store.users.get(id);
    if (user === undefined) throw new InvalidInputError('Usuário inexistente.');
    const lower = nickname.toLowerCase();
    for (const other of this.store.users.values()) {
      if (other.id !== id && other.nickname.toLowerCase() === lower) throw new NicknameTakenError();
    }
    this.store.users.set(id, { ...user, nickname });
  }

  async getAvatar(userId: string): Promise<AvatarParts | null> {
    // Avatar gravado fora do catálogo (formato antigo) volta como `null`: o cliente usa o padrão.
    return parseAvatarParts(this.store.avatars.get(normalizeId(userId)));
  }

  async saveAvatar(userId: string, parts: AvatarParts): Promise<void> {
    const id = normalizeId(userId);
    const valid = assertAvatarParts(parts);
    this.requireUser(id);
    this.store.avatars.set(id, valid);
  }

  async addBlock(blockerId: string, blockedId: string): Promise<void> {
    const blocker = normalizeId(blockerId);
    const blocked = normalizeId(blockedId);
    if (blocker === blocked) throw new InvalidInputError('Não é possível bloquear a si mesmo.');
    this.requireUser(blocker);
    this.requireUser(blocked);
    this.store.blocks.add(blockKey(blocker, blocked));
  }

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    this.store.blocks.delete(blockKey(normalizeId(blockerId), normalizeId(blockedId)));
  }

  async listBlockedIds(rawId: string): Promise<readonly string[]> {
    const prefix = `${normalizeId(rawId)}>`;
    return [...this.store.blocks]
      .filter((k) => k.startsWith(prefix))
      .map((k) => k.slice(prefix.length));
  }

  async listBlockerIds(rawId: string): Promise<readonly string[]> {
    const suffix = `>${normalizeId(rawId)}`;
    return [...this.store.blocks]
      .filter((k) => k.endsWith(suffix))
      .map((k) => k.slice(0, k.length - suffix.length));
  }

  async createReport(input: NewReportInput): Promise<ReportRecord> {
    assertReportText(input.text);
    const reporterId = normalizeId(input.reporterId);
    const reportedId = normalizeId(input.reportedId);
    const matchId = input.matchId === undefined ? null : normalizeId(input.matchId);
    if (reporterId === reportedId) {
      throw new InvalidInputError('Não é possível denunciar a si mesmo.');
    }
    this.requireUser(reporterId);
    this.requireUser(reportedId);
    if (matchId !== null && !this.store.matches.some((m) => m.id === matchId)) {
      throw new InvalidInputError('Usuário ou partida inexistente.');
    }
    const report: ReportRecord = {
      id: randomUUID(),
      reporterId,
      reportedId,
      matchId,
      reason: input.reason,
      text: input.text ?? null,
      status: 'open',
      createdAt: new Date(),
    };
    this.store.reports.push(report);
    return report;
  }

  async havePlayedTogether(userA: string, userB: string): Promise<boolean> {
    const [a, b] = orderPair(userA, userB);
    return this.store.matches.some(
      (m) =>
        m.input.status === 'finished' &&
        m.input.players.some(
          (pa) =>
            pa.userId === a &&
            m.input.players.some(
              (pb) => pb.userId === b && pb.team === pa.team && pb.seat !== pa.seat,
            ),
        ),
    );
  }

  async getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null> {
    const [a, b] = orderPair(userId, partnerId);
    return this.store.partnerCodes.get(`${a}|${b}`) ?? null;
  }

  async savePartnerCodes(userId: string, partnerId: string, codes: PartnerCodesMap): Promise<void> {
    const [a, b] = orderPair(userId, partnerId);
    assertPartnerCodes(codes);
    if (!(await this.havePlayedTogether(a, b))) throw new NotPartnersError();
    this.store.partnerCodes.set(`${a}|${b}`, { ...codes });
  }
}

export class MemoryMatchRepository implements MatchRepository {
  constructor(private readonly store: MemoryStore = new MemoryStore()) {}

  async saveMatch(raw: FinishedMatchInput): Promise<string> {
    const input = assertFinishedMatch(raw);
    for (const p of input.players) {
      if (p.userId !== null && !this.store.users.has(p.userId)) {
        throw new InvalidInputError('Usuário ou partida inexistente.');
      }
    }
    const id = randomUUID();
    this.store.matches.push({ id, input });
    return id;
  }

  async listForUser(
    userId: string,
    options?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MatchPage> {
    const me = normalizeId(userId);
    const limit = clampLimit(options?.limit, MATCH_PAGE_DEFAULT, MATCH_PAGE_MAX);
    const cursor = options?.cursor === undefined ? null : decodeCursor(options.cursor);
    const mine = this.store.matches
      .filter((m) => m.input.players.some((p) => p.userId === me))
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
