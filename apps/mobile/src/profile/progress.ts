/**
 * Conquistas e missões para exibição (puro). O servidor calcula tudo; aqui só texto e rótulos.
 * Textos pt-BR de `docs/gamificacao.md`.
 */
import { ACHIEVEMENT_IDS, ACHIEVEMENT_LEVELS, ACHIEVEMENT_TARGETS } from '@trucaco/protocol';
import type {
  AchievementId,
  MissionId,
  MissionPeriod,
  PublicAchievement,
  UserAchievement,
  UserMission,
} from '@trucaco/protocol';

export const ACHIEVEMENT_TEXT: Readonly<
  Record<AchievementId, { name: string; description: string }>
> = {
  primeira_vitoria: { name: 'Estreia vitoriosa', description: 'Vença a sua primeira partida.' },
  zap_na_mao: { name: 'Zap na mão', description: 'Vença vazas jogando o zap.' },
  doze_na_mesa: { name: 'Vale doze', description: 'Vença mãos valendo 12.' },
  virada: {
    name: 'Virada histórica',
    description: 'Vença um jogo estando 9 ou mais pontos atrás.',
  },
  mao_de_ferro: { name: 'De ferro', description: 'Vença mãos de ferro.' },
  serie_perfeita: { name: '2 a 0', description: 'Vença uma série melhor de 3 sem perder jogo.' },
  dupla_afinada: { name: 'Dupla afinada', description: 'Vença partidas com o mesmo parceiro.' },
  sinaleiro: { name: 'Sinaleiro', description: 'Use sinais em partidas.' },
  maratona: { name: 'Maratona', description: 'Jogue partidas.' },
};

export const LEVEL_LABEL: Readonly<Record<number, string>> = {
  0: 'Bloqueada',
  1: 'Bronze',
  2: 'Prata',
  3: 'Ouro',
};

/** Nome do nível `n` (1 a 3); fora disso, `Bloqueada`. */
export function levelLabel(level: number): string {
  return LEVEL_LABEL[level] ?? LEVEL_LABEL[0] ?? 'Bloqueada';
}

export const MISSION_TEXT: Readonly<Record<MissionId, string>> = {
  jogar_3_partidas: 'Jogar 3 partidas',
  vencer_1_partida: 'Vencer 1 partida',
  pedir_truco_3: 'Pedir truco 3 vezes',
  aceitar_2_aumentos: 'Aceitar 2 aumentos',
  usar_5_sinais: 'Usar 5 sinais',
  vencer_5_semana: 'Vencer 5 partidas na semana',
};

export const PERIOD_LABEL: Readonly<Record<MissionPeriod, string>> = {
  daily: 'Missões do dia',
  weekly: 'Missão da semana',
};

export interface AchievementRow {
  readonly id: AchievementId;
  readonly name: string;
  readonly description: string;
  readonly level: number;
  readonly levelLabel: string;
  readonly unlocked: boolean;
  /** "12 de 25" rumo ao próximo degrau; `Nível máximo` no ouro (ou único degrau cumprido). */
  readonly progressLabel: string;
  /** 0 a 1, rumo ao próximo degrau (1 no nível máximo). */
  readonly ratio: number;
  readonly accessibilityLabel: string;
}

export function achievementRow(a: UserAchievement): AchievementRow {
  const text = ACHIEVEMENT_TEXT[a.id];
  const targets = ACHIEVEMENT_TARGETS[a.id];
  const next = targets[a.level];
  const maxed = next === undefined;
  const progressLabel = maxed ? 'Nível máximo' : `${Math.min(a.progress, next)} de ${next}`;
  const ratio = maxed ? 1 : Math.max(0, Math.min(1, a.progress / next));
  const unlocked = a.level > 0;
  return {
    id: a.id,
    name: text.name,
    description: text.description,
    level: a.level,
    levelLabel: levelLabel(a.level),
    unlocked,
    progressLabel,
    ratio,
    accessibilityLabel: `${text.name}. ${text.description} ${levelLabel(a.level)}. ${progressLabel}.`,
  };
}

/** Todas as conquistas na ordem do catálogo, mesmo as que o servidor ainda não devolveu (nível 0). */
export function achievementRows(list: readonly UserAchievement[]): AchievementRow[] {
  const by = new Map(list.map((a) => [a.id, a] as const));
  return ACHIEVEMENT_IDS.map((id) =>
    achievementRow(by.get(id) ?? { id, level: 0, progress: 0, unlockedAt: null }),
  );
}

/** Perfil público: só o desbloqueado, com nome e nível. */
export function publicAchievementLine(a: PublicAchievement): string {
  return `${ACHIEVEMENT_TEXT[a.id].name} · ${levelLabel(a.level)}`;
}

export function publicAchievementLines(list: readonly PublicAchievement[]): string[] {
  const known = new Set<string>(ACHIEVEMENT_IDS);
  return list.filter((a) => known.has(a.id) && a.level > 0).map(publicAchievementLine);
}

export interface MissionRow {
  readonly key: string;
  readonly title: string;
  readonly period: MissionPeriod;
  readonly progressLabel: string;
  readonly done: boolean;
  readonly ratio: number;
  readonly accessibilityLabel: string;
}

export function missionRow(m: UserMission): MissionRow {
  const title = MISSION_TEXT[m.id];
  const done = m.completedAt !== null || m.progress >= m.target;
  const progressLabel = done ? 'Concluída' : `${m.progress} de ${m.target}`;
  return {
    key: `${m.id}:${m.periodKey}`,
    title,
    period: m.period,
    progressLabel,
    done,
    ratio: m.target > 0 ? Math.max(0, Math.min(1, m.progress / m.target)) : 0,
    accessibilityLabel: `${title}. ${progressLabel}.`,
  };
}

/** Diárias primeiro, depois a semanal; ids que este cliente não conhece (servidor mais novo) são ignorados. */
export function missionGroups(
  list: readonly UserMission[],
): { period: MissionPeriod; label: string; rows: MissionRow[] }[] {
  const known = list.filter((m) => Object.hasOwn(MISSION_TEXT, m.id));
  return (['daily', 'weekly'] as const)
    .map((period) => ({
      period,
      label: PERIOD_LABEL[period],
      rows: known.filter((m) => m.period === period).map(missionRow),
    }))
    .filter((g) => g.rows.length > 0);
}

export interface AchievementGain {
  readonly id: AchievementId;
  readonly name: string;
  readonly levelLabel: string;
}

/** Conquistas cujo nível subiu entre `before` e `after` (ao fim da partida). Sem baseline = nada. */
export function achievementGains(
  before: readonly UserAchievement[] | null,
  after: readonly UserAchievement[],
): AchievementGain[] {
  if (before === null) return [];
  const prev = new Map(before.map((a) => [a.id, a.level] as const));
  const out: AchievementGain[] = [];
  for (const a of after) {
    if (!Object.hasOwn(ACHIEVEMENT_TEXT, a.id)) continue;
    if (a.level > (prev.get(a.id) ?? 0) && a.level >= 1) {
      out.push({ id: a.id, name: ACHIEVEMENT_TEXT[a.id].name, levelLabel: levelLabel(a.level) });
    }
  }
  return out;
}

/** Quantos níveis existem (3). Exposto para o teste conferir o catálogo. */
export const LEVEL_COUNT = ACHIEVEMENT_LEVELS.length;
