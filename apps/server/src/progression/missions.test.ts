import { randomUUID } from 'node:crypto';
import { DAILY_MISSIONS_PER_DAY, MISSION_DEFINITIONS } from '@trucaco/protocol';
import { describe, expect, it } from 'vitest';
import {
  advanceMissions,
  dailyMissionsFor,
  weeklyMissionsFor,
  type MissionCounters,
} from './missions';

const ZERO: MissionCounters = { played: 0, won: 0, betsCalled: 0, betsAccepted: 0, signals: 0 };
const DAY = '2026-11-04';

describe('dailyMissionsFor', () => {
  it('sorteia 3 diárias distintas, com meta do catálogo, e é determinístico', () => {
    const id = randomUUID();
    const a = dailyMissionsFor(id, DAY);
    expect(a).toHaveLength(DAILY_MISSIONS_PER_DAY);
    expect(new Set(a.map((m) => m.missionId)).size).toBe(DAILY_MISSIONS_PER_DAY);
    for (const m of a) {
      expect(MISSION_DEFINITIONS[m.missionId].period).toBe('daily');
      expect(m.target).toBe(MISSION_DEFINITIONS[m.missionId].target);
      expect(m.periodKey).toBe(DAY);
    }
    expect(dailyMissionsFor(id, DAY)).toEqual(a);
  });

  it('muda entre dias e entre usuários (mais de um sorteio possível)', () => {
    const sets = new Set<string>();
    for (let i = 0; i < 40; i++) {
      sets.add(
        dailyMissionsFor(randomUUID(), DAY)
          .map((m) => m.missionId)
          .join(),
      );
    }
    expect(sets.size).toBeGreaterThan(3);
    const id = randomUUID();
    const days = new Set<string>();
    for (let d = 1; d <= 30; d++) {
      const key = `2026-11-${String(d).padStart(2, '0')}`;
      days.add(
        dailyMissionsFor(id, key)
          .map((m) => m.missionId)
          .join(),
      );
    }
    expect(days.size).toBeGreaterThan(1);
  });
});

describe('weeklyMissionsFor', () => {
  it('é uma só: vencer 5 na semana', () => {
    expect(weeklyMissionsFor('2026-W45')).toEqual([
      { missionId: 'vencer_5_semana', periodKey: '2026-W45', target: 5 },
    ]);
  });
});

describe('advanceMissions', () => {
  const all = (periodKey: string) =>
    (Object.keys(MISSION_DEFINITIONS) as (keyof typeof MISSION_DEFINITIONS)[]).map((missionId) => ({
      missionId,
      periodKey,
      target: MISSION_DEFINITIONS[missionId].target,
    }));

  it('cada missão avança com o contador certo', () => {
    const out = advanceMissions(all(DAY), {
      played: 1,
      won: 1,
      betsCalled: 2,
      betsAccepted: 3,
      signals: 4,
    });
    const by = Object.fromEntries(out.map((m) => [m.missionId, m.progressDelta]));
    expect(by).toEqual({
      jogar_3_partidas: 1,
      vencer_1_partida: 1,
      pedir_truco_3: 2,
      aceitar_2_aumentos: 3,
      usar_5_sinais: 4,
      vencer_5_semana: 1,
    });
  });

  it('derrota e partida sem apostas nem sinais só avançam "jogar"', () => {
    const out = advanceMissions(all(DAY), { ...ZERO, played: 1 });
    expect(out.map((m) => m.missionId)).toEqual(['jogar_3_partidas']);
  });

  it('só avançam as missões atribuídas', () => {
    const assigned = [{ missionId: 'vencer_1_partida', periodKey: DAY, target: 1 }] as const;
    expect(advanceMissions(assigned, { ...ZERO, played: 1, won: 1, signals: 9 })).toEqual([
      { missionId: 'vencer_1_partida', periodKey: DAY, target: 1, progressDelta: 1 },
    ]);
    expect(advanceMissions([], { ...ZERO, played: 1 })).toEqual([]);
  });
});
