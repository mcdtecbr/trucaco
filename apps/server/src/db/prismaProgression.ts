import {
  achievementLevelFor,
  isAchievementId,
  isMissionId,
  parseAvatarParts,
} from '@trucaco/protocol';
import type { MissionId } from '@trucaco/protocol';
import type { PrismaClient } from '../generated/prisma/client';
import { guarded } from './prismaErrors';
import {
  type AchievementRecord,
  type AchievementUnlock,
  type ApplyProgressResult,
  type MissionCompletion,
  type MissionRecord,
  type ProgressionRepository,
  type PublicProfileRecord,
  type StatsRecord,
  type UserProgressDelta,
  PROGRESS_CAP,
} from './types';
import {
  assertMissionId,
  assertMissionTarget,
  assertPeriodKey,
  assertProgressDeltas,
  normalizeId,
} from './validation';

/**
 * Progressão sobre Postgres. `applyMatchProgress` roda numa transação interativa:
 *
 * 1. `INSERT INTO progression_applied ... ON CONFLICT DO NOTHING`: quem insere (1 linha) aplica; quem não
 *    insere devolve `applied: false`. Uma segunda transação simultânea para o mesmo `match_id` BLOQUEIA no
 *    índice único até a primeira confirmar, e então não insere: a aplicação acontece uma única vez.
 * 2. Estatísticas, conquistas e missões por `INSERT ... ON CONFLICT DO UPDATE` (soma atômica no banco, sem
 *    ler-modificar-gravar; partidas diferentes do mesmo usuário se serializam no bloqueio da linha).
 *    Usuário e partida em ordem fixa (`assertProgressDeltas`) para evitar deadlock.
 * 3. O nível vem do progresso final (`achievementLevelFor`, catálogo em código) e só sobe.
 */
export class PrismaProgressionRepository implements ProgressionRepository {
  constructor(private readonly db: PrismaClient) {}

  async applyMatchProgress(
    rawMatchId: string,
    rawDeltas: readonly UserProgressDelta[],
  ): Promise<ApplyProgressResult> {
    const matchId = normalizeId(rawMatchId);
    const deltas = assertProgressDeltas(rawDeltas);
    return guarded(() =>
      this.db.$transaction(async (tx) => {
        const marked = await tx.$executeRaw`
          INSERT INTO progression_applied (match_id) VALUES (${matchId}::uuid)
          ON CONFLICT (match_id) DO NOTHING`;
        if (marked === 0) return { applied: false, unlocked: [], missionsCompleted: [] };
        const now = new Date();
        const unlocked: AchievementUnlock[] = [];
        const missionsCompleted: MissionCompletion[] = [];
        for (const d of deltas) {
          await tx.$executeRaw`
            INSERT INTO user_stats (user_id, variant, played, won)
            VALUES (${d.userId}::uuid, ${d.variant}::variant, ${d.played}::int, ${d.won}::int)
            ON CONFLICT (user_id, variant) DO UPDATE
              SET played = LEAST(${PROGRESS_CAP}::int, user_stats.played + ${d.played}::int),
                  won = LEAST(${PROGRESS_CAP}::int, user_stats.won + ${d.won}::int),
                  updated_at = now()`;
          for (const a of d.achievements) {
            const rows =
              a.progressSet !== undefined
                ? await tx.$queryRaw<{ progress: number; level: number }[]>`
                    INSERT INTO user_achievements (user_id, achievement_id, progress)
                    VALUES (${d.userId}::uuid, ${a.achievementId}, ${a.progressSet}::int)
                    ON CONFLICT (user_id, achievement_id) DO UPDATE
                      SET progress = ${a.progressSet}::int, updated_at = now()
                    RETURNING progress, level`
                : await tx.$queryRaw<{ progress: number; level: number }[]>`
                    INSERT INTO user_achievements (user_id, achievement_id, progress)
                    VALUES (${d.userId}::uuid, ${a.achievementId}, ${a.progressDelta ?? 0}::int)
                    ON CONFLICT (user_id, achievement_id) DO UPDATE
                      SET progress = LEAST(${PROGRESS_CAP}::int,
                                           user_achievements.progress + ${a.progressDelta ?? 0}::int),
                          updated_at = now()
                    RETURNING progress, level`;
            const row = rows[0];
            if (row === undefined) continue;
            const previousLevel = Number(row.level);
            const progress = Number(row.progress);
            const level = Math.max(previousLevel, achievementLevelFor(a.achievementId, progress));
            if (level > previousLevel) {
              await tx.$executeRaw`
                UPDATE user_achievements
                   SET level = ${level}::smallint,
                       unlocked_at = COALESCE(unlocked_at, ${a.unlockedAt ?? now}::timestamptz)
                 WHERE user_id = ${d.userId}::uuid AND achievement_id = ${a.achievementId}`;
              unlocked.push({
                userId: d.userId,
                achievementId: a.achievementId,
                previousLevel,
                level,
                progress,
              });
            }
          }
          for (const m of d.missions) {
            await tx.$executeRaw`
              INSERT INTO user_missions (user_id, mission_id, period_key, target, progress)
              VALUES (${d.userId}::uuid, ${m.missionId}, ${m.periodKey}, ${m.target}::int,
                      LEAST(${m.target}::int, ${m.progressDelta}::int))
              ON CONFLICT (user_id, mission_id, period_key) DO UPDATE
                SET progress = LEAST(user_missions.target,
                                     user_missions.progress + ${m.progressDelta}::int)`;
            const done = await tx.$queryRaw<{ ok: number }[]>`
              UPDATE user_missions SET completed_at = ${m.completedAt ?? now}::timestamptz
               WHERE user_id = ${d.userId}::uuid AND mission_id = ${m.missionId}
                 AND period_key = ${m.periodKey}
                 AND completed_at IS NULL AND progress >= target
              RETURNING 1 AS ok`;
            if (done.length > 0) {
              missionsCompleted.push({
                userId: d.userId,
                missionId: m.missionId,
                periodKey: m.periodKey,
              });
            }
          }
        }
        return { applied: true, unlocked, missionsCompleted };
      }),
    );
  }

  async listAchievements(userId: string): Promise<readonly AchievementRecord[]> {
    const rows = await this.db.userAchievement.findMany({
      where: { userId: normalizeId(userId) },
      orderBy: { achievementId: 'asc' },
    });
    return rows.flatMap((r) =>
      isAchievementId(r.achievementId)
        ? [
            {
              achievementId: r.achievementId,
              level: r.level,
              progress: r.progress,
              unlockedAt: r.unlockedAt,
            },
          ]
        : [],
    );
  }

  async listMissions(
    userId: string,
    periodKeys: readonly string[],
  ): Promise<readonly MissionRecord[]> {
    const keys = periodKeys.map(assertPeriodKey);
    const rows = await this.db.userMission.findMany({
      where: { userId: normalizeId(userId), periodKey: { in: [...keys] } },
      orderBy: [{ periodKey: 'asc' }, { missionId: 'asc' }],
    });
    return rows.flatMap((r) =>
      isMissionId(r.missionId)
        ? [
            {
              missionId: r.missionId,
              periodKey: r.periodKey,
              target: r.target,
              progress: r.progress,
              completedAt: r.completedAt,
            },
          ]
        : [],
    );
  }

  async getStats(userId: string): Promise<readonly StatsRecord[]> {
    const rows = await this.db.userStat.findMany({
      where: { userId: normalizeId(userId) },
    });
    return rows
      .map((r) => ({ variant: r.variant, played: r.played, won: r.won }))
      .sort((a, b) => (a.variant < b.variant ? -1 : 1));
  }

  async getPublicProfile(userId: string): Promise<PublicProfileRecord | null> {
    const id = normalizeId(userId);
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        nickname: true,
        avatar: { select: { parts: true } },
        achievements: { where: { level: { gt: 0 } }, orderBy: { achievementId: 'asc' } },
        stats: { orderBy: { variant: 'asc' } },
      },
    });
    if (user === null) return null;
    return {
      userId: id,
      nickname: user.nickname,
      avatar: user.avatar === null ? null : parseAvatarParts(user.avatar.parts),
      achievements: user.achievements.flatMap((a) =>
        isAchievementId(a.achievementId)
          ? [{ achievementId: a.achievementId, level: a.level }]
          : [],
      ),
      stats: user.stats
        .map((s) => ({ variant: s.variant, played: s.played, won: s.won }))
        .sort((a, b) => (a.variant < b.variant ? -1 : 1)),
    };
  }

  async ensureMissions(
    userId: string,
    rawPeriodKey: string,
    defs: readonly { readonly missionId: MissionId; readonly target: number }[],
  ): Promise<readonly MissionRecord[]> {
    const id = normalizeId(userId);
    const periodKey = assertPeriodKey(rawPeriodKey);
    for (const d of defs) {
      assertMissionId(d.missionId);
      assertMissionTarget(d.target);
    }
    // ON CONFLICT DO NOTHING: chamadas simultâneas não duplicam nem alteram a meta já gravada.
    await guarded(() =>
      this.db.userMission.createMany({
        data: [...defs]
          .sort((x, y) => (x.missionId < y.missionId ? -1 : x.missionId > y.missionId ? 1 : 0))
          .map((d) => ({
            userId: id,
            missionId: d.missionId,
            periodKey,
            target: d.target,
          })),
        skipDuplicates: true,
      }),
    );
    return this.listMissions(id, [periodKey]);
  }
}
