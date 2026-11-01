import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
  InvalidInputError,
  MATCH_PAGE_DEFAULT,
  MATCH_PAGE_MAX,
  NicknameTakenError,
  ProviderSubjectTakenError,
  type AuthProviderId,
  type FinishedMatchInput,
  type JsonObject,
  type JsonValue,
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

function isKnown(error: unknown, code: string): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/**
 * Nome da constraint violada. Com driver adapter o `meta.target` não vem; o nome aparece na
 * mensagem ("...failed on the constraint: `users_nickname_lower_key`"), que também cita o código
 * da chamada, então só o nome completo da constraint é confiável.
 */
const NICKNAME_CONSTRAINT = 'users_nickname_lower_key';
const PROVIDER_CONSTRAINT = 'users_provider_provider_subject_key';

function asJson(value: JsonValue): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toUser(row: {
  id: string;
  provider: AuthProviderId;
  providerSubject: string;
  nickname: string;
  createdAt: Date;
  lastSeenAt: Date;
}): UserRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerSubject: row.providerSubject,
    nickname: row.nickname,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async createGuest(input: NewGuestInput): Promise<UserRecord> {
    assertNickname(input.nickname);
    try {
      const row = await this.db.user.create({
        data: {
          provider: 'guest',
          providerSubject: input.providerSubject,
          nickname: input.nickname,
        },
      });
      return toUser(row);
    } catch (error) {
      if (isKnown(error, 'P2002')) {
        if (error.message.includes(NICKNAME_CONSTRAINT)) throw new NicknameTakenError();
        if (error.message.includes(PROVIDER_CONSTRAINT)) throw new ProviderSubjectTakenError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { id } });
    return row === null ? null : toUser(row);
  }

  async findByProvider(
    provider: AuthProviderId,
    providerSubject: string,
  ): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({
      where: { provider_providerSubject: { provider, providerSubject } },
    });
    return row === null ? null : toUser(row);
  }

  async touchLastSeen(id: string, at: Date): Promise<void> {
    await this.db.user.updateMany({ where: { id }, data: { lastSeenAt: at } });
  }

  async getAvatar(userId: string): Promise<JsonObject | null> {
    const row = await this.db.avatar.findUnique({ where: { userId } });
    return row !== null && isJsonObject(row.parts) ? row.parts : null;
  }

  async saveAvatar(userId: string, parts: JsonObject): Promise<void> {
    try {
      await this.db.avatar.upsert({
        where: { userId },
        create: { userId, parts: asJson(parts) },
        update: { parts: asJson(parts) },
      });
    } catch (error) {
      if (isKnown(error, 'P2003')) throw new InvalidInputError('Usuário inexistente.');
      throw error;
    }
  }

  async addBlock(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) throw new InvalidInputError('Não é possível bloquear a si mesmo.');
    try {
      await this.db.block.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
      });
    } catch (error) {
      if (isKnown(error, 'P2003')) throw new InvalidInputError('Usuário inexistente.');
      throw error;
    }
  }

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    await this.db.block.deleteMany({ where: { blockerId, blockedId } });
  }

  async listBlockedIds(userId: string): Promise<readonly string[]> {
    const rows = await this.db.block.findMany({
      where: { blockerId: userId },
      select: { blockedId: true },
    });
    return rows.map((r) => r.blockedId);
  }

  async listBlockerIds(userId: string): Promise<readonly string[]> {
    const rows = await this.db.block.findMany({
      where: { blockedId: userId },
      select: { blockerId: true },
    });
    return rows.map((r) => r.blockerId);
  }

  async createReport(input: NewReportInput): Promise<ReportRecord> {
    assertReportText(input.text);
    if (input.reporterId === input.reportedId) {
      throw new InvalidInputError('Não é possível denunciar a si mesmo.');
    }
    try {
      const row = await this.db.report.create({
        data: {
          reporterId: input.reporterId,
          reportedId: input.reportedId,
          matchId: input.matchId ?? null,
          reason: input.reason,
          text: input.text ?? null,
        },
      });
      return row;
    } catch (error) {
      if (isKnown(error, 'P2003')) throw new InvalidInputError('Usuário ou partida inexistente.');
      throw error;
    }
  }

  async getPartnerCodes(userId: string, partnerId: string): Promise<PartnerCodesMap | null> {
    const [userAId, userBId] = orderPair(userId, partnerId);
    const row = await this.db.partnerCodes.findUnique({
      where: { userAId_userBId: { userAId, userBId } },
    });
    if (row === null || !isJsonObject(row.codes)) return null;
    const codes: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.codes)) {
      if (typeof value === 'string') codes[key] = value;
    }
    return codes;
  }

  async savePartnerCodes(userId: string, partnerId: string, codes: PartnerCodesMap): Promise<void> {
    assertPartnerCodes(codes);
    const [userAId, userBId] = orderPair(userId, partnerId);
    try {
      await this.db.partnerCodes.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: { userAId, userBId, codes },
        update: { codes },
      });
    } catch (error) {
      if (isKnown(error, 'P2003')) throw new InvalidInputError('Usuário inexistente.');
      throw error;
    }
  }
}

export class PrismaMatchRepository implements MatchRepository {
  constructor(private readonly db: PrismaClient) {}

  async saveMatch(input: FinishedMatchInput): Promise<string> {
    // Uma instrução com create aninhado: o Prisma a executa em transação.
    const row = await this.db.match.create({
      data: {
        variant: input.variant,
        format: input.format,
        ironHand: input.ironHand,
        visibility: input.visibility,
        roomCode: input.roomCode,
        seed: BigInt(input.seed),
        options: asJson(input.options),
        events: asJson(input.events as unknown as JsonValue),
        deals: input.deals === null ? Prisma.DbNull : asJson(input.deals),
        winnerTeam: input.winnerTeam,
        games: asJson(input.games),
        status: input.status,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        players: {
          create: input.players.map((p) => ({
            seat: p.seat,
            userId: p.userId,
            team: p.team,
            botFrom: p.botFrom,
          })),
        },
      },
      select: { id: true },
    });
    return row.id;
  }

  async listForUser(
    userId: string,
    options?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MatchPage> {
    const limit = clampLimit(options?.limit, MATCH_PAGE_DEFAULT, MATCH_PAGE_MAX);
    const cursor = options?.cursor === undefined ? null : decodeCursor(options.cursor);
    // `deals`, `events` e `seed` ficam de fora de propósito (nunca saem por REST).
    const rows = await this.db.match.findMany({
      where: {
        players: { some: { userId } },
        ...(cursor === null
          ? {}
          : {
              OR: [
                { endedAt: { lt: cursor.endedAt } },
                { endedAt: cursor.endedAt, id: { lt: cursor.id } },
              ],
            }),
      },
      orderBy: [{ endedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        variant: true,
        format: true,
        ironHand: true,
        visibility: true,
        status: true,
        winnerTeam: true,
        games: true,
        startedAt: true,
        endedAt: true,
        players: {
          orderBy: { seat: 'asc' },
          select: {
            seat: true,
            team: true,
            userId: true,
            botFrom: true,
            user: { select: { nickname: true } },
          },
        },
      },
    });
    const page = rows.slice(0, limit);
    const items: MatchSummary[] = page.map((m) => ({
      id: m.id,
      variant: m.variant,
      format: m.format,
      ironHand: m.ironHand,
      visibility: m.visibility,
      status: m.status,
      winnerTeam: m.winnerTeam === 0 || m.winnerTeam === 1 ? m.winnerTeam : null,
      games: Array.isArray(m.games) ? (m.games as readonly JsonValue[]) : [],
      startedAt: m.startedAt,
      endedAt: m.endedAt,
      players: m.players.map((p) => ({
        seat: p.seat,
        team: p.team === 1 ? 1 : 0,
        userId: p.userId,
        nickname: p.user?.nickname ?? null,
        botFrom: p.botFrom,
      })),
    }));
    const last = page[page.length - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeCursor({ endedAt: last.endedAt, id: last.id })
        : null;
    return { items, nextCursor };
  }
}
