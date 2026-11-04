import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_IDS,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_TARGETS,
  DAILY_MISSIONS_PER_DAY,
  MISSION_DEFINITIONS,
  MISSION_IDS,
  MISSION_PERIODS,
  achievementLevelFor,
  isAchievementId,
  isMissionId,
  nextAchievementTarget,
} from './index';

describe('conquistas', () => {
  it('ids únicos, os 9 do catálogo inicial e sem o adiado', () => {
    expect(new Set(ACHIEVEMENT_IDS).size).toBe(ACHIEVEMENT_IDS.length);
    expect(ACHIEVEMENT_IDS).toHaveLength(9);
    expect(ACHIEVEMENT_IDS).toContain('sinaleiro');
    expect(ACHIEVEMENT_IDS).not.toContain('corredor_esperto');
  });

  it('metas: uma lista por id, crescente, inteira e com no máximo 3 níveis', () => {
    expect(Object.keys(ACHIEVEMENT_TARGETS).sort()).toEqual([...ACHIEVEMENT_IDS].sort());
    for (const id of ACHIEVEMENT_IDS) {
      const t = ACHIEVEMENT_TARGETS[id];
      expect(t.length).toBeGreaterThanOrEqual(1);
      expect(t.length).toBeLessThanOrEqual(ACHIEVEMENT_LEVELS.length);
      for (const [i, v] of t.entries()) {
        expect(Number.isInteger(v) && v >= 1).toBe(true);
        if (i > 0) expect(v).toBeGreaterThan(t[i - 1] as number);
      }
    }
  });

  it('metas batem com docs/gamificacao.md', () => {
    expect(ACHIEVEMENT_TARGETS.primeira_vitoria).toEqual([1]);
    expect(ACHIEVEMENT_TARGETS.zap_na_mao).toEqual([1, 25, 100]);
    expect(ACHIEVEMENT_TARGETS.doze_na_mesa).toEqual([1, 10, 30]);
    expect(ACHIEVEMENT_TARGETS.virada).toEqual([1, 5, 15]);
    expect(ACHIEVEMENT_TARGETS.mao_de_ferro).toEqual([1, 5, 15]);
    expect(ACHIEVEMENT_TARGETS.serie_perfeita).toEqual([1, 10, 30]);
    expect(ACHIEVEMENT_TARGETS.dupla_afinada).toEqual([5, 25, 100]);
    expect(ACHIEVEMENT_TARGETS.sinaleiro).toEqual([10, 50, 200]);
    expect(ACHIEVEMENT_TARGETS.maratona).toEqual([10, 100, 500]);
  });

  it('achievementLevelFor e nextAchievementTarget', () => {
    expect(achievementLevelFor('zap_na_mao', 0)).toBe(0);
    expect(achievementLevelFor('zap_na_mao', 1)).toBe(1);
    expect(achievementLevelFor('zap_na_mao', 24)).toBe(1);
    expect(achievementLevelFor('zap_na_mao', 25)).toBe(2);
    expect(achievementLevelFor('zap_na_mao', 9999)).toBe(3);
    expect(achievementLevelFor('primeira_vitoria', 5)).toBe(1);
    expect(nextAchievementTarget('zap_na_mao', 1)).toBe(25);
    expect(nextAchievementTarget('zap_na_mao', 100)).toBeNull();
    expect(nextAchievementTarget('maratona', 0)).toBe(10);
  });

  it('isAchievementId', () => {
    expect(isAchievementId('maratona')).toBe(true);
    expect(isAchievementId('sinaleiro')).toBe(true);
    expect(isAchievementId('corredor_esperto')).toBe(false);
    expect(isAchievementId('__proto__')).toBe(false);
    expect(isAchievementId(3)).toBe(false);
  });
});

describe('missões', () => {
  it('ids únicos: 5 diárias e 1 semanal, com definição para cada um', () => {
    expect(new Set(MISSION_IDS).size).toBe(MISSION_IDS.length);
    expect(Object.keys(MISSION_DEFINITIONS).sort()).toEqual([...MISSION_IDS].sort());
    const daily = MISSION_IDS.filter((id) => MISSION_DEFINITIONS[id].period === 'daily');
    const weekly = MISSION_IDS.filter((id) => MISSION_DEFINITIONS[id].period === 'weekly');
    expect(daily).toHaveLength(5);
    expect(weekly).toEqual(['vencer_5_semana']);
    expect(MISSION_PERIODS).toEqual(['daily', 'weekly']);
  });

  it('metas inteiras positivas e coerentes com a decisão 3 do plano', () => {
    for (const id of MISSION_IDS) {
      const t = MISSION_DEFINITIONS[id].target;
      expect(Number.isInteger(t) && t >= 1).toBe(true);
    }
    expect(MISSION_DEFINITIONS.jogar_3_partidas.target).toBe(3);
    expect(MISSION_DEFINITIONS.vencer_1_partida.target).toBe(1);
    expect(MISSION_DEFINITIONS.pedir_truco_3.target).toBe(3);
    expect(MISSION_DEFINITIONS.aceitar_2_aumentos.target).toBe(2);
    expect(MISSION_DEFINITIONS.usar_5_sinais.target).toBe(5);
    expect(MISSION_DEFINITIONS.vencer_5_semana.target).toBe(5);
  });

  it('há diárias suficientes para o sorteio', () => {
    const daily = MISSION_IDS.filter((id) => MISSION_DEFINITIONS[id].period === 'daily');
    expect(daily.length).toBeGreaterThanOrEqual(DAILY_MISSIONS_PER_DAY);
  });

  it('isMissionId', () => {
    expect(isMissionId('usar_5_sinais')).toBe(true);
    expect(isMissionId('nope')).toBe(false);
    expect(isMissionId('constructor')).toBe(false);
  });
});
