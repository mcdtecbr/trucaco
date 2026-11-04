/**
 * Catálogo de conquistas e missões (Fase 6, `docs/gamificacao.md`). Só ids, metas e tipos de progresso:
 * a avaliação roda no servidor a partir do log da partida, nunca de mensagem do cliente.
 * Ids estáveis: NUNCA renomear nem remover, só acrescentar (estão gravados no banco).
 * `corredor_esperto` fica fora do catálogo inicial (decisão 3 do plano da Fase 6); `sinaleiro` entra com o
 * contador de sinais vindo da sala (`signalsBySeat`, bloco 6D), nunca de mensagem do cliente.
 */

export const ACHIEVEMENT_IDS = [
  'primeira_vitoria',
  'zap_na_mao',
  'doze_na_mesa',
  'virada',
  'mao_de_ferro',
  'serie_perfeita',
  'dupla_afinada',
  'sinaleiro',
  'maratona',
] as const;

export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Níveis em ordem crescente; o nível `n` (1 a 3) corresponde a `ACHIEVEMENT_LEVELS[n - 1]`. */
export const ACHIEVEMENT_LEVELS = ['bronze', 'silver', 'gold'] as const;
export type AchievementLevelName = (typeof ACHIEVEMENT_LEVELS)[number];

/**
 * Metas (progresso necessário) por nível, crescentes. Conquista "única" tem um só degrau (`[1]`).
 * Valores propostos em `docs/gamificacao.md`; calibrar no beta.
 */
export const ACHIEVEMENT_TARGETS: Readonly<Record<AchievementId, readonly number[]>> = {
  primeira_vitoria: [1],
  zap_na_mao: [1, 25, 100],
  doze_na_mesa: [1, 10, 30],
  virada: [1, 5, 15],
  mao_de_ferro: [1, 5, 15],
  serie_perfeita: [1, 10, 30],
  dupla_afinada: [5, 25, 100],
  sinaleiro: [10, 50, 200],
  maratona: [10, 100, 500],
};

export function isAchievementId(x: unknown): x is AchievementId {
  return typeof x === 'string' && (ACHIEVEMENT_IDS as readonly string[]).includes(x);
}

/** Nível alcançado (0 = nenhum) para um progresso. */
export function achievementLevelFor(id: AchievementId, progress: number): number {
  let level = 0;
  for (const target of ACHIEVEMENT_TARGETS[id]) {
    if (progress >= target) level += 1;
  }
  return level;
}

/** Próxima meta, ou `null` se já está no nível máximo. */
export function nextAchievementTarget(id: AchievementId, progress: number): number | null {
  return ACHIEVEMENT_TARGETS[id][achievementLevelFor(id, progress)] ?? null;
}

/** Progresso de uma conquista do próprio jogador (`GET /me/achievements`). */
export interface UserAchievement {
  readonly id: AchievementId;
  /** 0 = ainda não desbloqueada; 1 a N = índice do degrau alcançado (N = `ACHIEVEMENT_TARGETS[id].length`). */
  readonly level: number;
  readonly progress: number;
  /** ISO 8601 do desbloqueio do nível 1; `null` se `level === 0`. */
  readonly unlockedAt: string | null;
}

/** Visão pública (perfil de outro jogador): só o que está desbloqueado, sem progresso nem datas. */
export interface PublicAchievement {
  readonly id: AchievementId;
  readonly level: number;
}

export const MISSION_PERIODS = ['daily', 'weekly'] as const;
export type MissionPeriod = (typeof MISSION_PERIODS)[number];

export const MISSION_IDS = [
  'jogar_3_partidas',
  'vencer_1_partida',
  'pedir_truco_3',
  'aceitar_2_aumentos',
  'usar_5_sinais',
  'vencer_5_semana',
] as const;

export type MissionId = (typeof MISSION_IDS)[number];

export interface MissionDefinition {
  readonly period: MissionPeriod;
  readonly target: number;
}

/** Período e meta de cada missão. As diárias são sorteadas (3 por dia); a semanal é uma só. */
export const MISSION_DEFINITIONS: Readonly<Record<MissionId, MissionDefinition>> = {
  jogar_3_partidas: { period: 'daily', target: 3 },
  vencer_1_partida: { period: 'daily', target: 1 },
  pedir_truco_3: { period: 'daily', target: 3 },
  aceitar_2_aumentos: { period: 'daily', target: 2 },
  usar_5_sinais: { period: 'daily', target: 5 },
  vencer_5_semana: { period: 'weekly', target: 5 },
};

/** Quantas missões diárias o jogador recebe por dia. */
export const DAILY_MISSIONS_PER_DAY = 3;
/** Fuso que define a virada do dia e da semana. */
export const MISSION_TIME_ZONE = 'America/Sao_Paulo';

export function isMissionId(x: unknown): x is MissionId {
  return typeof x === 'string' && (MISSION_IDS as readonly string[]).includes(x);
}

/** Missão do jogador num período (`GET /me/missions`). */
export interface UserMission {
  readonly id: MissionId;
  readonly period: MissionPeriod;
  /** Chave do período em `America/Sao_Paulo`: `2026-11-04` (diária) ou `2026-W45` (semanal, ISO). */
  readonly periodKey: string;
  readonly target: number;
  /** Nunca passa de `target`. */
  readonly progress: number;
  /** ISO 8601; `null` enquanto não concluída. */
  readonly completedAt: string | null;
}
