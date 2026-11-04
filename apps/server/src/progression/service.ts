/**
 * Aplica a progressão de uma partida gravada (Fase 6, bloco 6D): junta avaliação (`achievements.ts`),
 * missões atribuídas (`missions.ts`) e o repositório (idempotente por `matchId`, ADR 0009). Chamado pela sala
 * DEPOIS de gravar a partida; quem chama cuida de erro (a progressão nunca derruba a gravação nem a sala).
 */
import { InvalidInputError } from '../db/types';
import type { FinishedMatchInput, ProgressionRepository, UserProgressDelta } from '../db/types';
import type { ApplyProgressResult } from '../db/types';
import { evaluateMatch, isEligibleForProgression } from './achievements';
import type { PartnerWins } from './achievements';
import { advanceMissions, dailyMissionsFor, weeklyMissionsFor } from './missions';
import { periodKeys } from './period';

const partnerSeat = (seat: number): number => (seat + 2) % 4;

export async function applyMatchProgression(
  progression: ProgressionRepository,
  matchId: string,
  match: FinishedMatchInput,
  signalsBySeat: ReadonlyMap<number, number>,
): Promise<ApplyProgressResult | null> {
  if (!isEligibleForProgression(match)) return null;
  // Contexto de `dupla_afinada`: vitórias com o parceiro (já contando esta partida) e o melhor já gravado.
  const partnerWins = new Map<string, PartnerWins>();
  await Promise.all(
    match.players.map(async (p) => {
      const partner = match.players.find((q) => q.seat === partnerSeat(p.seat))?.userId;
      if (p.userId === null || partner == null || p.team !== match.winnerTeam) return;
      const [applied, rows] = await Promise.all([
        progression.countWinsTogether(p.userId, partner),
        progression.listAchievements(p.userId),
      ]);
      // A contagem só traz partidas já aplicadas; esta (vencida pelo jogador) ainda não está marcada.
      const current = applied + 1;
      const best = rows.find((r) => r.achievementId === 'dupla_afinada')?.progress ?? 0;
      partnerWins.set(p.userId, { current, best });
    }),
  );
  const evaluations = evaluateMatch({ match, signalsBySeat, partnerWins });
  if (evaluations.length === 0) return null;
  const keys = periodKeys(match.endedAt);
  const deltas: UserProgressDelta[] = evaluations.map((e) => ({
    userId: e.userId,
    variant: e.variant,
    played: 1,
    won: e.won ? 1 : 0,
    achievements: e.achievements,
    missions: [
      ...advanceMissions(dailyMissionsFor(e.userId, keys.daily), e.counters),
      ...advanceMissions(weeklyMissionsFor(keys.weekly), e.counters),
    ],
  }));
  try {
    return await progression.applyMatchProgress(matchId, deltas);
  } catch (err) {
    if (!(err instanceof InvalidInputError)) throw err;
    // Conta apagada entre a gravação da partida e a avaliação: a transação foi desfeita inteira, então
    // refaz só com quem ainda existe (os outros três não perdem a partida).
    const alive: UserProgressDelta[] = [];
    for (const d of deltas) {
      if ((await progression.getPublicProfile(d.userId)) !== null) alive.push(d);
    }
    if (alive.length === 0 || alive.length === deltas.length) throw err;
    return progression.applyMatchProgress(matchId, alive);
  }
}
