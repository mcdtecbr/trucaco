import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db';
import type { FinishedMatchInput, UserRecord } from '../db/types';
import { applyMatchProgression } from './service';
import { dailyMissionsFor, weeklyMissionsFor } from './missions';

async function setup() {
  const repos = createMemoryRepositories();
  const users: UserRecord[] = [];
  for (let i = 0; i < 4; i++) {
    users.push(
      await repos.users.createGuest({
        providerSubject: `s-${i}-${Math.random()}`,
        nickname: `Jogador${i}`,
      }),
    );
  }
  const input = (endedAt: string, over: Partial<FinishedMatchInput> = {}): FinishedMatchInput => {
    const end = new Date(endedAt);
    return {
      variant: 'paulista',
      format: 'single',
      ironHand: true,
      visibility: 'public',
      roomCode: 'ABCD2345',
      seed: 1,
      options: {},
      events: [],
      deals: [],
      winnerTeam: 0,
      games: [{ game: 1, winnerTeam: 0, scores: [12, 3] }],
      status: 'finished',
      startedAt: new Date(end.getTime() - 60_000),
      endedAt: end,
      players: users.map((u, seat) => ({
        seat,
        userId: u.id,
        team: (seat % 2) as 0 | 1,
        botFrom: null,
      })),
      ...over,
    };
  };
  const play = async (
    endedAt: string,
    over: Partial<FinishedMatchInput> = {},
    signals: ReadonlyMap<number, number> = new Map(),
  ) => {
    const m = input(endedAt, over);
    const id = await repos.matches.saveMatch(m);
    return { id, m, result: await applyMatchProgression(repos.progression, id, m, signals) };
  };
  return { repos, users, play };
}

describe('applyMatchProgression', () => {
  it('estatísticas, conquistas e a missão semanal; derrota só joga', async () => {
    const { repos, users, play } = await setup();
    const { result } = await play('2026-11-04T15:00:00Z', {}, new Map([[1, 2]]));
    expect(result?.applied).toBe(true);
    // primeira_vitoria desbloqueia para os 2 vencedores (nível 1); maratona (meta 10) ainda não.
    expect(result?.unlocked.map((u) => [u.userId, u.achievementId]).sort()).toEqual(
      [users[0], users[2]].map((u) => [u?.id, 'primeira_vitoria']).sort(),
    );
    expect(await repos.progression.getStats(users[0]!.id)).toEqual([
      { variant: 'paulista', played: 1, won: 1 },
    ]);
    expect(await repos.progression.getStats(users[1]!.id)).toEqual([
      { variant: 'paulista', played: 1, won: 0 },
    ]);
    const ach1 = await repos.progression.listAchievements(users[1]!.id);
    expect(ach1.map((a) => [a.achievementId, a.progress])).toEqual([
      ['maratona', 1],
      ['sinaleiro', 1],
    ]);
    const weekly = await repos.progression.listMissions(users[0]!.id, ['2026-W45']);
    expect(weekly).toMatchObject([{ missionId: 'vencer_5_semana', progress: 1, target: 5 }]);
    expect(await repos.progression.listMissions(users[1]!.id, ['2026-W45'])).toEqual([]);
  });

  it('só avançam as diárias sorteadas para o jogador', async () => {
    const { repos, users, play } = await setup();
    await play('2026-11-04T15:00:00Z', {}, new Map([[0, 7]]));
    const assigned = new Set(dailyMissionsFor(users[0]!.id, '2026-11-04').map((m) => m.missionId));
    const rows = await repos.progression.listMissions(users[0]!.id, ['2026-11-04']);
    for (const r of rows) expect(assigned.has(r.missionId)).toBe(true);
    // jogar e vencer avançam sempre que sorteadas; sinais: meta 5, 7 sinais completam.
    for (const r of rows) {
      if (r.missionId === 'usar_5_sinais') expect(r.progress).toBe(5);
      if (r.missionId === 'jogar_3_partidas') expect(r.progress).toBe(1);
      if (r.missionId === 'vencer_1_partida') expect(r.progress).toBe(1);
    }
  });

  it('reprocessar a mesma partida não dobra nada (idempotência por matchId)', async () => {
    const { repos, users, play } = await setup();
    const { id, m } = await play('2026-11-04T15:00:00Z');
    const again = await applyMatchProgression(repos.progression, id, m, new Map());
    expect(again).toEqual({ applied: false, unlocked: [], missionsCompleted: [] });
    expect(await repos.progression.getStats(users[0]!.id)).toEqual([
      { variant: 'paulista', played: 1, won: 1 },
    ]);
    expect(
      (await repos.progression.listAchievements(users[0]!.id)).find(
        (a) => a.achievementId === 'maratona',
      )?.progress,
    ).toBe(1);
  });

  it('a chave do período vem do fim da partida, em Brasília (borda da meia-noite)', async () => {
    const { repos, users, play } = await setup();
    await play('2026-11-04T02:59:59Z'); // 03/11 23:59:59 local
    await play('2026-11-04T03:00:00Z'); // 04/11 00:00:00 local
    const weekly = weeklyMissionsFor('2026-W45')[0]!;
    const rows = await repos.progression.listMissions(users[0]!.id, [
      '2026-11-03',
      '2026-11-04',
      '2026-W45',
    ]);
    const keys = new Set(rows.map((r) => r.periodKey));
    expect(keys.has('2026-W45')).toBe(true);
    const day3 = rows.filter((r) => r.periodKey === '2026-11-03');
    const day4 = rows.filter((r) => r.periodKey === '2026-11-04');
    // Cada partida avança só o dia dela.
    for (const r of [...day3, ...day4]) expect(r.progress).toBe(1);
    // A semanal é a mesma (W45) e acumula as duas vitórias.
    expect(rows.find((r) => r.missionId === weekly.missionId)?.progress).toBe(2);
  });

  it('dupla_afinada: vitórias com o mesmo parceiro, sem regredir com outro parceiro', async () => {
    const { repos, users, play } = await setup();
    for (let i = 0; i < 5; i++) await play(`2026-11-04T1${i}:00:00Z`);
    const a0 = (await repos.progression.listAchievements(users[0]!.id)).find(
      (a) => a.achievementId === 'dupla_afinada',
    );
    expect(a0).toMatchObject({ progress: 5, level: 1 });
    // Derrota não mexe.
    await play('2026-11-04T18:00:00Z', { winnerTeam: 1 });
    expect(
      (await repos.progression.listAchievements(users[0]!.id)).find(
        (a) => a.achievementId === 'dupla_afinada',
      )?.progress,
    ).toBe(5);
    // Dupla 1 (usuários 1 e 3) venceu 1 vez com esse parceiro: progresso 1, nível 0.
    expect(
      (await repos.progression.listAchievements(users[1]!.id)).find(
        (a) => a.achievementId === 'dupla_afinada',
      )?.progress,
    ).toBe(1);
  });

  it('partida inelegível (bot, cancelada) não grava progressão', async () => {
    const { repos, users, play } = await setup();
    const base = (await play('2026-11-04T12:00:00Z')).m;
    const withBot = await play('2026-11-04T13:00:00Z', {
      players: base.players.map((p) => (p.seat === 3 ? { ...p, botFrom: 10 } : p)),
    });
    expect(withBot.result).toBeNull();
    const cancelled = await play('2026-11-04T14:00:00Z', { status: 'cancelled', winnerTeam: null });
    expect(cancelled.result).toBeNull();
    // Só a primeira partida contou.
    expect(await repos.progression.getStats(users[0]!.id)).toEqual([
      { variant: 'paulista', played: 1, won: 1 },
    ]);
  });

  it('conta apagada entre a gravação e a avaliação: os outros três ainda pontuam', async () => {
    const { repos, users, play } = await setup();
    const m = (await play('2026-11-04T12:00:00Z')).m; // partida já aplicada: só para ter o formato
    expect(m.players).toHaveLength(4);
    const input = { ...m, endedAt: new Date('2026-11-04T16:00:00Z') };
    const id = await repos.matches.saveMatch(input);
    await repos.users.deleteUser(users[3]!.id);
    const result = await applyMatchProgression(repos.progression, id, input, new Map());
    expect(result?.applied).toBe(true);
    expect(await repos.progression.getStats(users[0]!.id)).toEqual([
      { variant: 'paulista', played: 2, won: 2 },
    ]);
    expect(await repos.progression.getStats(users[1]!.id)).toEqual([
      { variant: 'paulista', played: 2, won: 0 },
    ]);
    expect(await repos.progression.getStats(users[3]!.id)).toEqual([]);
  });

  it('erro que não é de entrada (banco fora) sobe para quem chama', async () => {
    const { repos, users, play } = await setup();
    const boom = {
      ...repos.progression,
      applyMatchProgress: () => Promise.reject(new Error('banco fora')),
      countWinsTogether: () => Promise.resolve(0),
      listAchievements: () => Promise.resolve([]),
    } as unknown as typeof repos.progression;
    const m = (await play('2026-11-04T12:00:00Z')).m;
    await expect(applyMatchProgression(boom, 'x', m, new Map())).rejects.toThrow('banco fora');
    expect(users).toHaveLength(4);
  });
});
