/**
 * Aplica a progressão de uma partida gravada (Fase 6, bloco 6D): junta avaliação (`achievements.ts`),
 * missões atribuídas (`missions.ts`) e o repositório (idempotente por `matchId`, ADR 0009). Chamado pela sala
 * DEPOIS de gravar a partida; quem chama cuida de erro (a progressão nunca derruba a gravação nem a sala).
 */
import { InvalidInputError } from '../db/types';
import type { FinishedMatchInput, ProgressionRepository, UserProgressDelta } from '../db/types';
import type { ApplyProgressResult } from '../db/types';
import {
  DEFAULT_PROGRESSION_POLICY,
  PAIR_LIMIT_WINDOW_MS,
  evaluateMatch,
  isEligibleForProgression,
  isValidMatch,
} from './achievements';
import type { PartnerWins, ProgressionPolicy } from './achievements';
import { metrics } from '../metrics';
import { advanceMissions, dailyMissionsFor, weeklyMissionsFor } from './missions';
import { periodKeys } from './period';

const partnerSeat = (seat: number): number => (seat + 2) % 4;

/**
 * Checagens que dependem do banco (anti-farm por conluio, auditoria 6I): mesa privada só de convidados e
 * teto de partidas pontuadas por par de jogadores nas 24 h anteriores.
 */
async function passesCollusionChecks(
  progression: ProgressionRepository,
  match: FinishedMatchInput,
  policy: ProgressionPolicy,
): Promise<boolean> {
  const ids = match.players.flatMap((p) => (p.userId === null ? [] : [p.userId]));
  if (policy.blockAllGuestPrivate && match.visibility === 'private') {
    if ((await progression.countGuests(ids)) === ids.length) return false;
  }
  const until = match.endedAt;
  const since = new Date(until.getTime() - PAIR_LIMIT_WINDOW_MS);
  if (match.visibility === 'private') {
    for (const id of ids) {
      if (
        (await progression.countScoredPrivateMatches(id, since, until)) >=
        policy.userPrivateDailyLimit
      ) {
        return false;
      }
    }
  }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const n = await progression.countMatchesTogether(
        ids[i] as string,
        ids[j] as string,
        since,
        until,
      );
      if (n >= policy.pairDailyLimit) return false;
    }
  }
  return true;
}

export async function applyMatchProgression(
  progression: ProgressionRepository,
  matchId: string,
  match: FinishedMatchInput,
  signalsBySeat: ReadonlyMap<number, number>,
  policy: ProgressionPolicy = DEFAULT_PROGRESSION_POLICY,
): Promise<ApplyProgressResult | null> {
  // Partida inválida (cancelada, bot, conta repetida): nada é gravado.
  if (!isValidMatch(match)) return null;
  // Anti-farm: só gateia conquistas e missões. A estatística (`user_stats`) conta toda partida válida.
  const scoring =
    isEligibleForProgression(match, policy) &&
    (await passesCollusionChecks(progression, match, policy));
  // Contexto de `dupla_afinada`: vitórias com o parceiro (já contando esta partida) e o melhor já gravado.
  const partnerWins = new Map<string, PartnerWins>();
  await Promise.all(
    match.players.map(async (p) => {
      if (!scoring) return;
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
  const keys = periodKeys(match.endedAt);
  const evaluations = scoring ? evaluateMatch({ match, signalsBySeat, partnerWins, policy }) : [];
  const deltas: UserProgressDelta[] =
    evaluations.length > 0
      ? evaluations.map((e) => ({
          userId: e.userId,
          variant: e.variant,
          played: 1,
          won: e.won ? 1 : 0,
          achievements: e.achievements,
          missions: [
            ...advanceMissions(dailyMissionsFor(e.userId, keys.daily), e.counters),
            ...advanceMissions(weeklyMissionsFor(keys.weekly), e.counters),
          ],
        }))
      : match.players.flatMap((p) =>
          p.userId === null
            ? []
            : [
                {
                  userId: p.userId,
                  variant: match.variant,
                  played: 1,
                  won: p.team === match.winnerTeam ? 1 : 0,
                  achievements: [],
                  missions: [],
                },
              ],
        );
  const options = { scored: evaluations.length > 0 };
  // Só conta `notScored` quando a partida foi de fato aplicada (reaplicação duplicada não infla a métrica).
  const done = (result: ApplyProgressResult): ApplyProgressResult => {
    if (!scoring && result.applied) metrics.inc('progressionNotScored');
    return result;
  };
  try {
    return done(await progression.applyMatchProgress(matchId, deltas, options));
  } catch (err) {
    if (!(err instanceof InvalidInputError)) throw err;
    // Conta apagada entre a gravação da partida e a avaliação: a transação foi desfeita inteira, então
    // refaz só com quem ainda existe (os outros três não perdem a partida).
    const alive: UserProgressDelta[] = [];
    for (const d of deltas) {
      if ((await progression.getPublicProfile(d.userId)) !== null) alive.push(d);
    }
    if (alive.length === 0 || alive.length === deltas.length) throw err;
    return done(await progression.applyMatchProgress(matchId, alive, options));
  }
}
