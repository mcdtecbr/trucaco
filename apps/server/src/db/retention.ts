/**
 * Job de retenção (docs/banco-de-dados.md, "Retenção"). Roda em processo, uma vez por dia, atrás de
 * `RETENTION_ENABLED=true`. Cada passo apaga em LOTES de uma instrução SQL (atômica e curta, sem segurar
 * lock longo), repete até acabar ou até o teto de lotes por execução, e é idempotente (rodar duas vezes
 * não muda o resultado). O log traz só contagens: nenhum id, apelido ou conteúdo.
 *
 * Passos e prazos (padrões da política; mudar não exige migração):
 * Partida citada por denúncia ABERTA (`reports.status = 'open'`) não é tocada em nenhum dos 3 passos de
 * partida (nem `deals`, que é a evidência de trapaça): fica até a moderação tratar a denúncia.
 *
 * 1. `matches.deals` (cartas de todos) zerado após 30 dias;
 * 2. partidas `cancelled` apagadas após 30 dias;
 * 3. partidas (linha, `events`, `match_players`) apagadas após 12 meses (denúncias viram `match_id` NULL);
 * 4. convidados inativos: `last_seen_at` com mais de 90 dias, nunca vinculados, SEM assento em partida,
 *    estatística, conquista com progresso ou denúncia aberta contra eles (as cascatas do banco limpam
 *    avatar, bloqueios e combinados);
 * 5. `user_missions` de períodos com mais de 90 dias (a chave do período é a data).
 *
 * Uma instância só (estado em memória; docs/specs/2026-11-05-fase-7-plano.md). Duas execuções
 * simultâneas seriam inofensivas (os passos são idempotentes), só redundantes.
 */
import { log } from '../logger';
import { periodKeys } from '../progression/period';
import type { PrismaClient } from '../generated/prisma/client';

export interface RetentionConfig {
  /** `matches.deals` -> NULL depois disto. */
  readonly dealsDays: number;
  /** Partidas `cancelled`. */
  readonly cancelledDays: number;
  /** Partidas terminadas (e tudo que cascateia). */
  readonly matchesDays: number;
  /** Convidados sem atividade. */
  readonly guestInactiveDays: number;
  /** `user_missions` de períodos antigos. */
  readonly missionsDays: number;
  /** Linhas por instrução SQL. */
  readonly batchSize: number;
  /** Teto de lotes por passo e por execução (o resto fica para o dia seguinte). */
  readonly maxBatchesPerStep: number;
}

export const DEFAULT_RETENTION: RetentionConfig = {
  dealsDays: 30,
  cancelledDays: 30,
  matchesDays: 365,
  guestInactiveDays: 90,
  missionsDays: 90,
  batchSize: 500,
  maxBatchesPerStep: 200,
};

export interface RetentionResult {
  readonly dealsCleared: number;
  readonly cancelledDeleted: number;
  readonly matchesDeleted: number;
  readonly guestsDeleted: number;
  readonly missionsDeleted: number;
}

const DAY_MS = 86_400_000;

async function inBatches(
  cfg: RetentionConfig,
  step: (limit: number) => Promise<number>,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < cfg.maxBatchesPerStep; i++) {
    const n = await step(cfg.batchSize);
    total += n;
    if (n < cfg.batchSize) break;
  }
  return total;
}

/** Uma execução completa. Erro de qualquer passo sobe (o agendador registra o nome e tenta amanhã). */
export async function runRetention(
  db: PrismaClient,
  now: Date = new Date(),
  overrides: Partial<RetentionConfig> = {},
): Promise<RetentionResult> {
  const cfg = { ...DEFAULT_RETENTION, ...overrides };
  const before = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();

  const dealsCutoff = before(cfg.dealsDays);
  const dealsCleared = await inBatches(
    cfg,
    (limit) =>
      db.$executeRaw`
      UPDATE matches SET deals = NULL
      WHERE id IN (
        SELECT m.id FROM matches m
        WHERE m.deals IS NOT NULL AND m.ended_at < ${dealsCutoff}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM reports r WHERE r.match_id = m.id AND r.status = 'open')
        LIMIT ${limit})`,
  );

  const cancelledCutoff = before(cfg.cancelledDays);
  const cancelledDeleted = await inBatches(
    cfg,
    (limit) =>
      db.$executeRaw`
      DELETE FROM matches
      WHERE id IN (
        SELECT m.id FROM matches m
        WHERE m.status = 'cancelled' AND m.ended_at < ${cancelledCutoff}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM reports r WHERE r.match_id = m.id AND r.status = 'open')
        LIMIT ${limit})`,
  );

  const matchesCutoff = before(cfg.matchesDays);
  const matchesDeleted = await inBatches(
    cfg,
    (limit) =>
      db.$executeRaw`
      DELETE FROM matches
      WHERE id IN (
        SELECT m.id FROM matches m
        WHERE m.ended_at < ${matchesCutoff}::timestamptz
          AND NOT EXISTS (
            SELECT 1 FROM reports r WHERE r.match_id = m.id AND r.status = 'open')
        LIMIT ${limit})`,
  );

  const guestCutoff = before(cfg.guestInactiveDays);
  const guestsDeleted = await inBatches(
    cfg,
    (limit) =>
      db.$executeRaw`
      DELETE FROM users
      WHERE id IN (
        SELECT u.id FROM users u
        WHERE u.provider = 'guest'
          AND u.linked_at IS NULL
          AND u.last_seen_at < ${guestCutoff}::timestamptz
          AND NOT EXISTS (SELECT 1 FROM match_players mp WHERE mp.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM user_stats s WHERE s.user_id = u.id)
          AND NOT EXISTS (
            SELECT 1 FROM user_achievements a
            WHERE a.user_id = u.id AND (a.level > 0 OR a.progress > 0))
          AND NOT EXISTS (
            SELECT 1 FROM reports r WHERE r.reported_id = u.id AND r.status = 'open')
        LIMIT ${limit})`,
  );

  const old = periodKeys(new Date(now.getTime() - cfg.missionsDays * DAY_MS));
  const missionsDeleted = await inBatches(
    cfg,
    (limit) =>
      db.$executeRaw`
      DELETE FROM user_missions
      WHERE (user_id, mission_id, period_key) IN (
        SELECT user_id, mission_id, period_key FROM user_missions
        WHERE (period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' AND period_key < ${old.daily})
           OR (period_key ~ '^[0-9]{4}-W[0-9]{2}$' AND period_key < ${old.weekly})
        LIMIT ${limit})`,
  );

  return { dealsCleared, cancelledDeleted, matchesDeleted, guestsDeleted, missionsDeleted };
}

export interface RetentionJob {
  /** Para o agendador (o desligamento do servidor chama). */
  stop(): void;
  /** Execução imediata (testes e operação manual); ignora se já há uma rodando. */
  runNow(): Promise<RetentionResult | null>;
}

export interface RetentionJobOptions {
  /** Intervalo entre execuções. Padrão 24 h. */
  readonly intervalMs?: number;
  /** Espera até a primeira execução depois do boot. Padrão 5 min (o servidor sobe e estabiliza antes). */
  readonly firstDelayMs?: number;
  readonly config?: Partial<RetentionConfig>;
}

/** Agenda `runRetention` (diária). Sem sobreposição; erro vira log (só o nome) e nova tentativa no próximo ciclo. */
export function startRetentionJob(db: PrismaClient, opts: RetentionJobOptions = {}): RetentionJob {
  let running = false;
  const runNow = async (): Promise<RetentionResult | null> => {
    if (running) return null;
    running = true;
    const startedAt = Date.now();
    try {
      const result = await runRetention(db, new Date(), opts.config);
      log.info('retention: concluído', { ...result, ms: Date.now() - startedAt });
      return result;
    } catch (err) {
      log.error('retention: falhou', { name: err instanceof Error ? err.name : 'unknown' });
      return null;
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void runNow(), opts.firstDelayMs ?? 300_000);
  const every = setInterval(() => void runNow(), opts.intervalMs ?? DAY_MS);
  first.unref();
  every.unref();
  return {
    stop: () => {
      clearTimeout(first);
      clearInterval(every);
    },
    runNow,
  };
}
