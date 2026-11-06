import { ACHIEVEMENT_IDS, MISSION_IDS } from '@trucaco/protocol';
import type { UserMission } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_TEXT,
  MISSION_TEXT,
  achievementGains,
  achievementRow,
  achievementRows,
  missionGroups,
  missionRow,
  publicAchievementLines,
} from './progress';

describe('textos do catálogo', () => {
  it('todo id do protocolo tem texto (conquista e missão)', () => {
    expect(ACHIEVEMENT_IDS.filter((id) => !(id in ACHIEVEMENT_TEXT))).toEqual([]);
    expect(MISSION_IDS.filter((id) => !(id in MISSION_TEXT))).toEqual([]);
  });
});

describe('conquistas', () => {
  it('bloqueada mostra progresso rumo ao primeiro degrau', () => {
    const r = achievementRow({ id: 'maratona', level: 0, progress: 4, unlockedAt: null });
    expect(r).toMatchObject({ unlocked: false, levelLabel: 'Bloqueada', progressLabel: '4 de 10' });
    expect(r.ratio).toBeCloseTo(0.4);
  });

  it('prata mira o ouro; ouro é nível máximo', () => {
    const silver = achievementRow({
      id: 'zap_na_mao',
      level: 2,
      progress: 40,
      unlockedAt: '2026-11-04T10:00:00Z',
    });
    expect(silver).toMatchObject({ levelLabel: 'Prata', progressLabel: '40 de 100' });
    const gold = achievementRow({ id: 'primeira_vitoria', level: 1, progress: 1, unlockedAt: 'x' });
    expect(gold).toMatchObject({ progressLabel: 'Nível máximo', ratio: 1 });
    expect(gold.accessibilityLabel).toContain('Estreia vitoriosa');
  });

  it('lista completa na ordem do catálogo, mesmo se o servidor omitir alguma', () => {
    const rows = achievementRows([{ id: 'maratona', level: 1, progress: 10, unlockedAt: 'x' }]);
    expect(rows.map((r) => r.id)).toEqual([...ACHIEVEMENT_IDS]);
    expect(rows.find((r) => r.id === 'sinaleiro')?.unlocked).toBe(false);
  });

  it('perfil público: só desbloqueadas e conhecidas', () => {
    const lines = publicAchievementLines([
      { id: 'maratona', level: 2 },
      { id: 'zap_na_mao', level: 0 },
      { id: 'inventada' as never, level: 1 },
    ]);
    expect(lines).toEqual(['Maratona · Prata']);
  });

  it('ganhos: só nível que subiu; sem foto, nada', () => {
    const a = (id: 'maratona' | 'virada', level: number) => ({
      id,
      level,
      progress: level,
      unlockedAt: null,
    });
    expect(achievementGains(null, [a('maratona', 1)])).toEqual([]);
    expect(
      achievementGains([a('maratona', 1), a('virada', 0)], [a('maratona', 2), a('virada', 0)]),
    ).toEqual([{ id: 'maratona', name: 'Maratona', levelLabel: 'Prata' }]);
    expect(achievementGains([a('maratona', 2)], [a('maratona', 2)])).toEqual([]);
  });
});

describe('missões', () => {
  const m = (over: Partial<UserMission>): UserMission => ({
    id: 'jogar_3_partidas',
    period: 'daily',
    periodKey: '2026-11-04',
    target: 3,
    progress: 1,
    completedAt: null,
    ...over,
  });

  it('em andamento e concluída', () => {
    expect(missionRow(m({}))).toMatchObject({ progressLabel: '1 de 3', done: false });
    expect(missionRow(m({ progress: 3, completedAt: 'x' }))).toMatchObject({
      progressLabel: 'Concluída',
      done: true,
      ratio: 1,
    });
  });

  it('agrupa diárias antes da semanal e ignora missão desconhecida', () => {
    const groups = missionGroups([
      m({ id: 'vencer_5_semana', period: 'weekly', periodKey: '2026-W45', target: 5 }),
      m({ id: 'usar_5_sinais', target: 5 }),
      m({ id: 'nova' as never }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Missões do dia', 'Missão da semana']);
    expect(groups[0]?.rows).toHaveLength(1);
  });
});
