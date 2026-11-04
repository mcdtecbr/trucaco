import { describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '../db';
import type { FinishedMatchInput, UserRecord } from '../db/types';
import { applyMatchProgression } from './service';
import { DEFAULT_PROGRESSION_POLICY } from './achievements';
import type { ProgressionPolicy } from './achievements';
import { dailyMissionsFor, weeklyMissionsFor } from './missions';

/** Padrão com o teto por par frouxo: os testes jogam várias partidas do mesmo grupo no mesmo dia. */
const LOOSE: ProgressionPolicy = { ...DEFAULT_PROGRESSION_POLICY, pairDailyLimit: 1000 };

const handsLog = (n: number): FinishedMatchInput['events'] =>
  Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    at: i,
    event: { type: 'handDecided', winnerTeam: 0, points: 1, reason: 'tricks', scores: [1, 0] },
  }));

async function setup(provider: 'google' | 'guest' = 'google') {
  const repos = createMemoryRepositories();
  const users: UserRecord[] = [];
  for (let i = 0; i < 4; i++) {
    const base = { providerSubject: `s-${i}-${Math.random()}`, nickname: `Jogador${i}` };
    users.push(
      provider === 'guest'
        ? await repos.users.createGuest(base)
        : await repos.users.createSocialUser({ ...base, provider }),
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
      events: handsLog(6),
      deals: [],
      winnerTeam: 0,
      games: [{ game: 1, winnerTeam: 0, scores: [12, 3] }],
      status: 'finished',
      startedAt: new Date(end.getTime() - 10 * 60_000),
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
    policy: ProgressionPolicy = LOOSE,
  ) => {
    const m = input(endedAt, over);
    const id = await repos.matches.saveMatch(m);
    return {
      id,
      m,
      result: await applyMatchProgression(repos.progression, id, m, signals, policy),
    };
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
    const again = await applyMatchProgression(repos.progression, id, m, new Map(), LOOSE);
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
    const result = await applyMatchProgression(repos.progression, id, input, new Map(), LOOSE);
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
      countMatchesTogether: () => Promise.resolve(0),
      countGuests: () => Promise.resolve(0),
      countScoredPrivateMatches: () => Promise.resolve(0),
      listAchievements: () => Promise.resolve([]),
    } as unknown as typeof repos.progression;
    const m = (await play('2026-11-04T12:00:00Z')).m;
    await expect(applyMatchProgression(boom, 'x', m, new Map(), LOOSE)).rejects.toThrow(
      'banco fora',
    );
    expect(users).toHaveLength(4);
  });

  describe('anti-farm por conluio (auditoria 6I)', () => {
    const DEF = DEFAULT_PROGRESSION_POLICY;
    type Repos = Awaited<ReturnType<typeof setup>>['repos'];
    const played = async (repos: Repos, id: string): Promise<number> =>
      (await repos.progression.getStats(id))[0]?.played ?? 0;
    /** `maratona` avança uma vez por partida PONTUADA: mede conquistas e missões. */
    const scoredCount = async (repos: Repos, id: string): Promise<number> =>
      (await repos.progression.listAchievements(id)).find((a) => a.achievementId === 'maratona')
        ?.progress ?? 0;

    it('poucas mãos ou partida curta: conta em user_stats, mas não pontua conquistas nem missões', async () => {
      const { repos, users, play } = await setup();
      const u = users[0]!.id;
      const few = await play('2026-11-04T10:00:00Z', { events: handsLog(3) }, new Map(), DEF);
      expect(few.result).toMatchObject({ applied: true, unlocked: [], missionsCompleted: [] });
      await play(
        '2026-11-04T11:00:00Z',
        { startedAt: new Date('2026-11-04T10:59:00Z') },
        new Map(),
        DEF,
      );
      expect(await played(repos, u)).toBe(2);
      expect(await repos.progression.listAchievements(u)).toEqual([]);
      expect(await repos.progression.listMissions(u, ['2026-11-04', '2026-W45'])).toEqual([]);
      const good = await play('2026-11-04T12:00:00Z', {}, new Map(), DEF);
      expect(good.result?.applied).toBe(true);
      expect(await played(repos, u)).toBe(3);
      expect(await scoredCount(repos, u)).toBe(1);
    });

    it('partida só de estatística é idempotente e não entra em dupla_afinada', async () => {
      const { repos, users, play } = await setup();
      const u = users[0]!.id;
      const few = await play('2026-11-04T10:00:00Z', { events: handsLog(1) }, new Map(), DEF);
      const again = await applyMatchProgression(repos.progression, few.id, few.m, new Map(), DEF);
      expect(again).toEqual({ applied: false, unlocked: [], missionsCompleted: [] });
      expect(await repos.progression.getStats(u)).toEqual([
        { variant: 'paulista', played: 1, won: 1 },
      ]);
      expect(await repos.progression.countWinsTogether(u, users[2]!.id)).toBe(0);
      await play('2026-11-04T12:00:00Z', {}, new Map(), DEF);
      const dupla = (await repos.progression.listAchievements(u)).find(
        (a) => a.achievementId === 'dupla_afinada',
      );
      expect(dupla?.progress).toBe(1);
    });

    it('log truncado pula o mínimo de mãos (só a duração vale)', async () => {
      const { repos, users, play } = await setup();
      await play(
        '2026-11-04T10:00:00Z',
        { events: [], options: { logTruncated: true } },
        new Map(),
        DEF,
      );
      expect(await scoredCount(repos, users[0]!.id)).toBe(1);
      await play('2026-11-04T11:00:00Z', { events: [] }, new Map(), DEF);
      expect(await scoredCount(repos, users[0]!.id)).toBe(1);
      expect(await played(repos, users[0]!.id)).toBe(2);
    });

    it('mesa privada só de convidados não pontua; pública de convidados e privada mista pontuam', async () => {
      const guests = await setup('guest');
      const g = guests.users[0]!.id;
      await guests.play('2026-11-04T10:00:00Z', { visibility: 'private' }, new Map(), DEF);
      expect(await scoredCount(guests.repos, g)).toBe(0);
      expect(await played(guests.repos, g)).toBe(1);
      await guests.play('2026-11-04T11:00:00Z', { visibility: 'public' }, new Map(), DEF);
      expect(await scoredCount(guests.repos, g)).toBe(1);
      const mixed = await setup('guest');
      await mixed.repos.users.linkProvider(mixed.users[2]!.id, 'google', 'sub-link');
      await mixed.play('2026-11-04T10:00:00Z', { visibility: 'private' }, new Map(), DEF);
      expect(await scoredCount(mixed.repos, mixed.users[0]!.id)).toBe(1);
    });

    it('o mesmo grupo pontua no máximo N partidas por 24 h; depois da janela volta', async () => {
      const { repos, users, play } = await setup();
      const u = users[0]!.id;
      const policy = { ...DEF, pairDailyLimit: 2 };
      const t = (h: number) => `2026-11-04T${String(h).padStart(2, '0')}:00:00Z`;
      await play(t(10), {}, new Map(), policy);
      await play(t(11), {}, new Map(), policy);
      await play(t(12), {}, new Map(), policy);
      expect(await played(repos, u)).toBe(3);
      expect(await scoredCount(repos, u)).toBe(2);
      // 24 h depois da primeira, só a segunda ainda conta na janela
      await play('2026-11-05T10:30:00Z', {}, new Map(), policy);
      expect(await scoredCount(repos, u)).toBe(3);
    });

    it('basta UM par estourado para a partida não pontuar; todos ainda ganham estatística', async () => {
      const { repos, users, play } = await setup();
      const policy = { ...DEF, pairDailyLimit: 1 };
      await play('2026-11-04T10:00:00Z', {}, new Map(), policy);
      const others = [users[0]!, users[1]!];
      for (const [i, n] of ['X', 'Y'].entries()) {
        others.push(
          await repos.users.createSocialUser({
            provider: 'google',
            providerSubject: `x${i}`,
            nickname: `Outro${n}`,
          }),
        );
      }
      const m: FinishedMatchInput = {
        ...(await play('2026-11-04T11:00:00Z', {}, new Map(), LOOSE)).m,
        endedAt: new Date('2026-11-04T12:00:00Z'),
        startedAt: new Date('2026-11-04T11:50:00Z'),
        players: others.map((u, seat) => ({
          seat,
          userId: u.id,
          team: (seat % 2) as 0 | 1,
          botFrom: null,
        })),
      };
      const id = await repos.matches.saveMatch(m);
      const result = await applyMatchProgression(repos.progression, id, m, new Map(), policy);
      expect(result).toMatchObject({ applied: true, unlocked: [] });
      expect(await scoredCount(repos, users[0]!.id)).toBe(2);
      expect(await played(repos, users[0]!.id)).toBe(3);
      expect(await played(repos, others[2]!.id)).toBe(1);
      expect(await scoredCount(repos, others[2]!.id)).toBe(0);
    });

    it('teto diário por usuário em mesa privada: 1 conta social + 3 convidados novos por partida não escapa', async () => {
      const { repos, users, play } = await setup();
      const policy = { ...DEF, userPrivateDailyLimit: 2, pairDailyLimit: 1000 };
      // pública: não conta no teto privado
      const base = (await play('2026-11-04T09:00:00Z', {}, new Map(), LOOSE)).m;
      const farmer = users[0]!.id;
      for (let i = 0; i < 3; i++) {
        const fresh = [];
        for (let j = 0; j < 3; j++) {
          fresh.push(
            await repos.users.createGuest({
              providerSubject: `fg-${i}-${j}-${Math.random()}`,
              nickname: `Novo${i}${j}`,
            }),
          );
        }
        const m: FinishedMatchInput = {
          ...base,
          visibility: 'private',
          startedAt: new Date(`2026-11-04T1${i}:00:00Z`),
          endedAt: new Date(`2026-11-04T1${i}:30:00Z`),
          players: [users[0]!, ...fresh].map((u, seat) => ({
            seat,
            userId: u.id,
            team: (seat % 2) as 0 | 1,
            botFrom: null,
          })),
        };
        const id = await repos.matches.saveMatch(m);
        await applyMatchProgression(repos.progression, id, m, new Map(), policy);
      }
      // pública (1) + 2 privadas dentro do teto; a 3ª privada só conta estatística
      expect(await scoredCount(repos, farmer)).toBe(3);
      expect(await played(repos, farmer)).toBe(4);
    });
  });
});
