import { parseAvatarParts } from '@trucaco/protocol';
import type { AvatarParts } from '@trucaco/protocol';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import {
  InvalidInputError,
  MATCH_PAGE_DEFAULT,
  MATCH_PAGE_MAX,
  NotPartnersError,
  type AuthProviderId,
  type BlockedUserRecord,
  type FinishedMatchInput,
  type JsonObject,
  type JsonValue,
  type MatchPage,
  type MatchRepository,
  type MatchSummary,
  type NewGuestInput,
  type NewReportInput,
  type NewSocialUserInput,
  type PartnerCodesMap,
  type ReportRecord,
  type SocialProviderId,
  type UserRecord,
  type UserRepository,
} from './types';
import { guarded } from './prismaErrors';
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
  linkedAt: Date | null;
}): UserRecord {
  return {
    id: row.id,
    provider: row.provider,
    providerSubject: row.providerSubject,
    nickname: row.nickname,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    linkedAt: row.linkedAt,
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async createGuest(input: NewGuestInput): Promise<UserRecord> {
    const nickname = validateNickname(input.nickname);
    assertProviderSubject(input.providerSubject);
    return guarded(async () => {
      const row = await this.db.user.create({
        data: { provider: 'guest', providerSubject: input.providerSubject, nickname },
      });
      return toUser(row);
    });
  }

  async createSocialUser(input: NewSocialUserInput): Promise<UserRecord> {
    const nickname = validateNickname(input.nickname);
    assertProviderSubject(input.providerSubject);
    return guarded(async () => {
      const row = await this.db.user.create({
        data: { provider: input.provider, providerSubject: input.providerSubject, nickname },
      });
      return toUser(row);
    });
  }

  async linkProvider(
    rawId: string,
    provider: SocialProviderId,
    providerSubject: string,
  ): Promise<UserRecord | null> {
    const id = normalizeId(rawId);
    assertProviderSubject(providerSubject);
    // UPDATE condicional (`provider = guest`): atômico no banco. A unicidade `(provider, subject)` barra o
    // mesmo `sub` em duas contas (P2002 -> `ProviderSubjectTakenError`).
    const result = await guarded(() =>
      this.db.user.updateMany({
        where: { id, provider: 'guest' },
        data: { provider, providerSubject, linkedAt: new Date() },
      }),
    );
    if (result.count === 0) return null;
    return this.findById(id);
  }

  async findById(id: string): Promise<UserRecord | null> {
    const row = await this.db.user.findUnique({ where: { id: normalizeId(id) } });
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
    await this.db.user.updateMany({ where: { id: normalizeId(id) }, data: { lastSeenAt: at } });
  }

  async updateNickname(rawId: string, rawNickname: string): Promise<void> {
    const id = normalizeId(rawId);
    const nickname = validateNickname(rawNickname);
    // A unicidade (índice em lower(nickname)) é traduzida por `guarded` em `NicknameTakenError`.
    const result = await guarded(() =>
      this.db.user.updateMany({ where: { id }, data: { nickname } }),
    );
    if (result.count === 0) throw new InvalidInputError('Usuário inexistente.');
  }

  async getAvatar(userId: string): Promise<AvatarParts | null> {
    const row = await this.db.avatar.findUnique({ where: { userId: normalizeId(userId) } });
    // Linha fora do catálogo (formato antigo) vira `null`: o cliente usa o padrão, sem erro.
    return row === null ? null : parseAvatarParts(row.parts);
  }

  async saveAvatar(userId: string, parts: AvatarParts): Promise<void> {
    const id = normalizeId(userId);
    const valid = assertAvatarParts(parts);
    await guarded(() =>
      this.db.avatar.upsert({
        where: { userId: id },
        create: { userId: id, parts: asJson({ ...valid } as JsonObject) },
        update: { parts: asJson({ ...valid } as JsonObject) },
      }),
    );
  }

  async addBlock(blockerId: string, blockedId: string): Promise<void> {
    const blocker = normalizeId(blockerId);
    const blocked = normalizeId(blockedId);
    if (blocker === blocked) throw new InvalidInputError('Não é possível bloquear a si mesmo.');
    await guarded(() =>
      this.db.block.upsert({
        where: { blockerId_blockedId: { blockerId: blocker, blockedId: blocked } },
        create: { blockerId: blocker, blockedId: blocked },
        update: {},
      }),
    );
  }

  async removeBlock(blockerId: string, blockedId: string): Promise<void> {
    await guarded(() =>
      this.db.block.deleteMany({
        where: { blockerId: normalizeId(blockerId), blockedId: normalizeId(blockedId) },
      }),
    );
  }

  async listBlockedIds(userId: string): Promise<readonly string[]> {
    const rows = await this.db.block.findMany({
      where: { blockerId: normalizeId(userId) },
      select: { blockedId: true },
    });
    return rows.map((r) => r.blockedId);
  }

  async listBlockerIds(userId: string): Promise<readonly string[]> {
    const rows = await this.db.block.findMany({
      where: { blockedId: normalizeId(userId) },
      select: { blockerId: true },
    });
    return rows.map((r) => r.blockerId);
  }

  async listBlocks(userId: string): Promise<readonly BlockedUserRecord[]> {
    const rows = await this.db.block.findMany({
      where: { blockerId: normalizeId(userId) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { blockedId: true, blocked: { select: { nickname: true } } },
    });
    return rows.map((r) => ({ userId: r.blockedId, nickname: r.blocked.nickname }));
  }

  async hasReport(
    reporterId: string,
    reportedId: string,
    matchId: string | null,
  ): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 3_600_000);
    const count = await this.db.report.count({
      where: {
        reporterId: normalizeId(reporterId),
        reportedId: normalizeId(reportedId),
        matchId: matchId === null ? null : normalizeId(matchId),
        ...(matchId === null ? { createdAt: { gte: since } } : {}),
      },
      take: 1,
    });
    return count > 0;
  }

  async countReportsAgainst(reportedId: string, since: Date): Promise<number> {
    return this.db.report.count({
      where: { reportedId: normalizeId(reportedId), throttled: false, createdAt: { gte: since } },
    });
  }

  async deleteUser(rawId: string): Promise<boolean> {
    const id = normalizeId(rawId);
    // Mesma transação: anula o texto livre das denúncias escritas pelo titular (LGPD) e só então apaga.
    // As cascatas e os SET NULL são do banco (docs/banco-de-dados.md). As denúncias CONTRA ele ficam.
    const [, result] = await guarded(() =>
      this.db.$transaction([
        this.db.report.updateMany({
          where: { reporterId: id, text: { not: null } },
          data: { text: null },
        }),
        this.db.user.deleteMany({ where: { id } }),
      ]),
    );
    return result.count > 0;
  }

  async sharedMatchSince(userA: string, userB: string, since: Date): Promise<boolean> {
    const a = normalizeId(userA);
    const b = normalizeId(userB);
    const rows = await this.db.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM match_players pa
          JOIN match_players pb ON pb.match_id = pa.match_id
          JOIN matches m ON m.id = pa.match_id
         WHERE pa.user_id = ${a}::uuid AND pb.user_id = ${b}::uuid
           AND m.ended_at >= ${since}::timestamptz
      ) AS ok`;
    return rows[0]?.ok === true;
  }

  async createReport(input: NewReportInput): Promise<ReportRecord> {
    assertReportText(input.text);
    const reporterId = normalizeId(input.reporterId);
    const reportedId = normalizeId(input.reportedId);
    const matchId = input.matchId === undefined ? null : normalizeId(input.matchId);
    if (reporterId === reportedId) {
      throw new InvalidInputError('Não é possível denunciar a si mesmo.');
    }
    return guarded(() =>
      this.db.report.create({
        data: {
          reporterId,
          reportedId,
          matchId,
          reason: input.reason,
          text: input.text ?? null,
          throttled: input.throttled === true,
        },
      }),
    );
  }

  async havePlayedTogether(userA: string, userB: string): Promise<boolean> {
    const [a, b] = orderPair(userA, userB);
    const rows = await this.db.$queryRaw<{ ok: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
          FROM match_players pa
          JOIN match_players pb
            ON pb.match_id = pa.match_id AND pb.team = pa.team AND pb.seat <> pa.seat
          JOIN matches m ON m.id = pa.match_id
         WHERE pa.user_id = ${a}::uuid AND pb.user_id = ${b}::uuid AND m.status = 'finished'
      ) AS ok`;
    return rows[0]?.ok === true;
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
    const [userAId, userBId] = orderPair(userId, partnerId);
    const clean = assertPartnerCodes(codes);
    if (!(await this.havePlayedTogether(userAId, userBId))) throw new NotPartnersError();
    await guarded(() =>
      this.db.partnerCodes.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: { userAId, userBId, codes: clean },
        update: { codes: clean },
      }),
    );
  }
}

export class PrismaMatchRepository implements MatchRepository {
  constructor(private readonly db: PrismaClient) {}

  async saveMatch(raw: FinishedMatchInput): Promise<string> {
    const input = assertFinishedMatch(raw);
    // Uma instrução com create aninhado: o Prisma a executa em transação.
    const row = await guarded(() =>
      this.db.match.create({
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
      }),
    );
    return row.id;
  }

  async participantIds(matchId: string): Promise<readonly string[] | null> {
    const rows = await this.db.matchPlayer.findMany({
      where: { matchId: normalizeId(matchId) },
      select: { userId: true },
    });
    if (rows.length === 0) return null;
    return rows.flatMap((r) => (r.userId === null ? [] : [r.userId]));
  }

  async listForUser(
    userId: string,
    options?: { readonly limit?: number; readonly cursor?: string },
  ): Promise<MatchPage> {
    const id = normalizeId(userId);
    const limit = clampLimit(options?.limit, MATCH_PAGE_DEFAULT, MATCH_PAGE_MAX);
    const cursor = options?.cursor === undefined ? null : decodeCursor(options.cursor);
    // `deals`, `events` e `seed` ficam de fora de propósito (nunca saem por REST).
    const rows = await this.db.match.findMany({
      where: {
        players: { some: { userId: id } },
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
