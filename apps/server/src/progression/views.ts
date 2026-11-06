/**
 * Monta as respostas de perfil (`GET /me`, `/me/achievements`, `/me/missions`, `/users/:id`) a partir dos
 * registros do repositório e do catálogo em código. Puro: completa o que ainda não tem linha no banco.
 */
import {
  ACHIEVEMENT_IDS,
  MISSION_DEFINITIONS,
  MISSION_IDS,
  type AchievementsResponse,
  type MissionsResponse,
  type PublicAchievement,
  type UserStats,
} from '@trucaco/protocol';
import type { AchievementRecord, MissionRecord, StatsRecord } from '../db/types';

/** Uma entrada por variante, com zeros para a que nunca foi jogada. */
export function toUserStats(records: readonly StatsRecord[]): UserStats {
  const pick = (variant: StatsRecord['variant']): { played: number; won: number } => {
    const r = records.find((x) => x.variant === variant);
    return { played: r?.played ?? 0, won: r?.won ?? 0 };
  };
  return { paulista: pick('paulista'), mineiro: pick('mineiro') };
}

/** O catálogo inteiro, na ordem de `ACHIEVEMENT_IDS`; sem linha = nível 0, progresso 0. */
export function toAchievementsResponse(
  records: readonly AchievementRecord[],
): AchievementsResponse {
  return {
    achievements: ACHIEVEMENT_IDS.map((id) => {
      const r = records.find((x) => x.achievementId === id);
      return {
        id,
        level: r?.level ?? 0,
        progress: r?.progress ?? 0,
        unlockedAt: r?.unlockedAt?.toISOString() ?? null,
      };
    }),
  };
}

/** Missões do dia e depois da semana, cada grupo na ordem do catálogo (estável entre chamadas). */
export function toMissionsResponse(records: readonly MissionRecord[]): MissionsResponse {
  const rank = (r: MissionRecord): number =>
    (MISSION_DEFINITIONS[r.missionId].period === 'daily' ? 0 : 1000) +
    MISSION_IDS.indexOf(r.missionId);
  return {
    missions: [...records]
      .sort((a, b) => rank(a) - rank(b))
      .map((r) => ({
        id: r.missionId,
        period: MISSION_DEFINITIONS[r.missionId].period,
        periodKey: r.periodKey,
        target: r.target,
        progress: Math.min(r.progress, r.target),
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
  };
}

export function toPublicAchievements(
  records: readonly { achievementId: PublicAchievement['id']; level: number }[],
): PublicAchievement[] {
  return records.filter((r) => r.level > 0).map((r) => ({ id: r.achievementId, level: r.level }));
}
