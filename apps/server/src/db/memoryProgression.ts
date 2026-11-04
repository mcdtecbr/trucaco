import {
  achievementLevelFor,
  isAchievementId,
  isMissionId,
  parseAvatarParts,
} from '@trucaco/protocol';
import type { MissionId } from '@trucaco/protocol';
import type { MemoryStore } from './memoryRepositories';
import {
  InvalidInputError,
  PROGRESS_CAP,
  type AchievementRecord,
  type AchievementUnlock,
  type ApplyProgressResult,
  type MissionCompletion,
  type MissionRecord,
  type ProgressionRepository,
  type PublicProfileRecord,
  type StatsRecord,
  type UserProgressDelta,
} from './types';
import {
  assertMissionId,
  assertMissionTarget,
  assertPeriodKey,
  assertProgressDeltas,
  normalizeId,
} from './validation';

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Progressão em memória (testes de sala). Espelha a versão Prisma: validação antes de escrever (tudo ou
 * nada), idempotência por `matchId`, FK de usuário e de partida, nível derivado do progresso.
 * Cada método escreve de forma síncrona (sem `await` no meio), então duas chamadas simultâneas não se misturam.
 */
export class MemoryProgressionRepository implements ProgressionRepository {
  constructor(private readonly store: MemoryStore) {}

  private requireUser(id: string): void {
    if (!this.store.users.has(id)) throw new InvalidInputError('Usuário inexistente.');
  }

  async applyMatchProgress(
    rawMatchId: string,
    rawDeltas: readonly UserProgressDelta[],
  ): Promise<ApplyProgressResult> {
    const matchId = normalizeId(rawMatchId);
    const deltas = assertProgressDeltas(rawDeltas);
    if (!this.store.matches.some((m) => m.id === matchId)) {
      throw new InvalidInputError('Usuário ou partida inexistente.');
    }
    // Mesma ordem do Prisma: partida já aplicada devolve applied:false antes de olhar os usuários.
    if (this.store.progressionApplied.has(matchId)) {
      return { applied: false, unlocked: [], missionsCompleted: [] };
    }
    for (const d of deltas) this.requireUser(d.userId);
    this.store.progressionApplied.add(matchId);
    const now = new Date();
    const unlocked: AchievementUnlock[] = [];
    const missionsCompleted: MissionCompletion[] = [];
    for (const d of deltas) {
      const statsKey = `${d.userId}|${d.variant}`;
      const st = this.store.stats.get(statsKey);
      this.store.stats.set(statsKey, {
        userId: d.userId,
        variant: d.variant,
        played: Math.min(PROGRESS_CAP, (st?.played ?? 0) + d.played),
        won: Math.min(PROGRESS_CAP, (st?.won ?? 0) + d.won),
      });
      for (const a of d.achievements) {
        const key = `${d.userId}|${a.achievementId}`;
        const old = this.store.achievements.get(key);
        const previousLevel = old?.level ?? 0;
        const progress = Math.min(
          PROGRESS_CAP,
          a.progressSet ?? (old?.progress ?? 0) + (a.progressDelta ?? 0),
        );
        const level = Math.max(previousLevel, achievementLevelFor(a.achievementId, progress));
        const unlockedAt = old?.unlockedAt ?? (level > 0 ? (a.unlockedAt ?? now) : null);
        this.store.achievements.set(key, {
          userId: d.userId,
          achievementId: a.achievementId,
          level,
          progress,
          unlockedAt,
        });
        if (level > previousLevel) {
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
        const key = `${d.userId}|${m.missionId}|${m.periodKey}`;
        const old = this.store.missions.get(key);
        const target = old?.target ?? m.target;
        const progress = Math.min(target, (old?.progress ?? 0) + m.progressDelta);
        let completedAt = old?.completedAt ?? null;
        if (completedAt === null && progress >= target) {
          completedAt = m.completedAt ?? now;
          missionsCompleted.push({
            userId: d.userId,
            missionId: m.missionId,
            periodKey: m.periodKey,
          });
        }
        this.store.missions.set(key, {
          userId: d.userId,
          missionId: m.missionId,
          periodKey: m.periodKey,
          target,
          progress,
          completedAt,
        });
      }
    }
    return { applied: true, unlocked, missionsCompleted };
  }

  async listAchievements(rawId: string): Promise<readonly AchievementRecord[]> {
    const id = normalizeId(rawId);
    return [...this.store.achievements.values()]
      .filter((r) => r.userId === id && isAchievementId(r.achievementId))
      .map(({ achievementId, level, progress, unlockedAt }) => ({
        achievementId,
        level,
        progress,
        unlockedAt,
      }))
      .sort((a, b) => byText(a.achievementId, b.achievementId));
  }

  async listMissions(
    rawId: string,
    periodKeys: readonly string[],
  ): Promise<readonly MissionRecord[]> {
    const id = normalizeId(rawId);
    const keys = new Set(periodKeys.map(assertPeriodKey));
    return [...this.store.missions.values()]
      .filter((r) => r.userId === id && keys.has(r.periodKey) && isMissionId(r.missionId))
      .map(({ missionId, periodKey, target, progress, completedAt }) => ({
        missionId,
        periodKey,
        target,
        progress,
        completedAt,
      }))
      .sort((a, b) => byText(a.periodKey, b.periodKey) || byText(a.missionId, b.missionId));
  }

  async getStats(rawId: string): Promise<readonly StatsRecord[]> {
    const id = normalizeId(rawId);
    return [...this.store.stats.values()]
      .filter((r) => r.userId === id)
      .map(({ variant, played, won }) => ({ variant, played, won }))
      .sort((a, b) => byText(a.variant, b.variant));
  }

  async getPublicProfile(rawId: string): Promise<PublicProfileRecord | null> {
    const id = normalizeId(rawId);
    const user = this.store.users.get(id);
    if (user === undefined) return null;
    return {
      userId: id,
      nickname: user.nickname,
      avatar: parseAvatarParts(this.store.avatars.get(id)),
      achievements: (await this.listAchievements(id))
        .filter((a) => a.level > 0)
        .map((a) => ({ achievementId: a.achievementId, level: a.level })),
      stats: await this.getStats(id),
    };
  }

  async ensureMissions(
    rawId: string,
    rawPeriodKey: string,
    defs: readonly { readonly missionId: MissionId; readonly target: number }[],
  ): Promise<readonly MissionRecord[]> {
    const id = normalizeId(rawId);
    const periodKey = assertPeriodKey(rawPeriodKey);
    for (const d of defs) {
      assertMissionId(d.missionId);
      assertMissionTarget(d.target);
    }
    // Sem nada a criar, igual ao Prisma (createMany vazio): devolve a lista, sem checar o usuário.
    if (defs.length > 0) this.requireUser(id);
    for (const d of defs) {
      const key = `${id}|${d.missionId}|${periodKey}`;
      if (!this.store.missions.has(key)) {
        this.store.missions.set(key, {
          userId: id,
          missionId: d.missionId,
          periodKey,
          target: d.target,
          progress: 0,
          completedAt: null,
        });
      }
    }
    return this.listMissions(id, [periodKey]);
  }
}
