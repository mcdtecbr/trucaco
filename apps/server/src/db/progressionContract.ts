import { describe, expect, it } from 'vitest';
import {
  InvalidInputError,
  type FinishedMatchInput,
  type MatchRepository,
  type ProgressionRepository,
  type UserProgressDelta,
  type UserRecord,
  type UserRepository,
} from './types';

/**
 * Contrato de `ProgressionRepository`: roda contra a memória SEMPRE (`progression.test.ts`) e contra o
 * Postgres quando há `TEST_DATABASE_URL` (`progression.int.test.ts`). As duas implementações têm de
 * responder igual. `reset` limpa o armazenamento antes de cada caso.
 */
export interface ProgressionHarness {
  readonly users: UserRepository;
  readonly matches: MatchRepository;
  readonly progression: ProgressionRepository;
  reset(): Promise<void>;
}

const GHOST = '00000000-0000-4000-8000-000000000000';
/** UUID que ordena DEPOIS de qualquer outro: a falha vem depois de escrever os usuários reais. */
const LAST_GHOST = 'ffffffff-ffff-4fff-bfff-ffffffffffff';
const DAY = '2026-11-04';
const NEXT_DAY = '2026-11-05';
const WEEK = '2026-W45';

export function progressionContract(name: string, harness: () => ProgressionHarness): void {
  describe(`ProgressionRepository: ${name}`, () => {
    let h: ProgressionHarness;
    let seq = 0;

    const setup = async (): Promise<void> => {
      await harness().reset();
      h = harness();
    };

    const user = (nick: string): Promise<UserRecord> =>
      h.users.createGuest({ providerSubject: `p-${++seq}-${nick}`, nickname: nick });

    const matchInput = async (players: readonly (string | null)[]): Promise<FinishedMatchInput> => {
      const endedAt = new Date('2026-11-04T12:00:00Z');
      return {
        variant: 'paulista',
        format: 'single',
        ironHand: false,
        visibility: 'public',
        roomCode: null,
        seed: 1,
        options: {},
        events: [],
        deals: null,
        winnerTeam: 0,
        games: [[12, 3]],
        status: 'finished',
        startedAt: new Date(endedAt.getTime() - 60_000),
        endedAt,
        players: players.map((userId, seat) => ({
          seat,
          userId,
          team: seat % 2 === 0 ? 0 : 1,
          botFrom: null,
        })),
      };
    };
    const match = async (players: readonly (string | null)[]): Promise<string> =>
      h.matches.saveMatch(await matchInput(players));

    const delta = (userId: string, over: Partial<UserProgressDelta> = {}): UserProgressDelta => ({
      userId,
      variant: 'paulista',
      played: 1,
      won: 1,
      achievements: [],
      missions: [],
      ...over,
    });

    describe('idempotência por partida', () => {
      it('aplicar o mesmo matchId duas vezes não dobra nada', async () => {
        await setup();
        const a = await user('Ana');
        const m = await match([a.id]);
        const deltas = [
          delta(a.id, {
            achievements: [{ achievementId: 'zap_na_mao', progressDelta: 1 }],
            missions: [
              { missionId: 'jogar_3_partidas', periodKey: DAY, target: 3, progressDelta: 1 },
            ],
          }),
        ];
        const first = await h.progression.applyMatchProgress(m, deltas);
        expect(first.applied).toBe(true);
        expect(first.unlocked).toEqual([
          { userId: a.id, achievementId: 'zap_na_mao', previousLevel: 0, level: 1, progress: 1 },
        ]);
        const second = await h.progression.applyMatchProgress(m, deltas);
        expect(second).toEqual({ applied: false, unlocked: [], missionsCompleted: [] });
        expect(await h.progression.getStats(a.id)).toEqual([
          { variant: 'paulista', played: 1, won: 1 },
        ]);
        const [ach] = await h.progression.listAchievements(a.id);
        expect(ach?.progress).toBe(1);
        const [mis] = await h.progression.listMissions(a.id, [DAY]);
        expect(mis?.progress).toBe(1);
      });

      it('aplicações simultâneas do mesmo matchId aplicam uma única vez', async () => {
        await setup();
        const a = await user('Ana');
        const b = await user('Beto');
        const m = await match([a.id, b.id]);
        const deltas = [
          delta(a.id, { achievements: [{ achievementId: 'maratona', progressDelta: 1 }] }),
          delta(b.id, { won: 0 }),
        ];
        const results = await Promise.all(
          Array.from({ length: 6 }, () => h.progression.applyMatchProgress(m, deltas)),
        );
        expect(results.filter((r) => r.applied)).toHaveLength(1);
        expect(await h.progression.getStats(a.id)).toEqual([
          { variant: 'paulista', played: 1, won: 1 },
        ]);
        expect((await h.progression.listAchievements(a.id))[0]?.progress).toBe(1);
      });

      it('partidas diferentes do mesmo usuário em paralelo somam sem perder incremento', async () => {
        await setup();
        const a = await user('Ana');
        const ms = await Promise.all([1, 2, 3, 4].map(() => match([a.id])));
        await Promise.all(
          ms.map((m) =>
            h.progression.applyMatchProgress(m, [
              delta(a.id, { achievements: [{ achievementId: 'maratona', progressDelta: 1 }] }),
            ]),
          ),
        );
        expect(await h.progression.getStats(a.id)).toEqual([
          { variant: 'paulista', played: 4, won: 4 },
        ]);
        expect((await h.progression.listAchievements(a.id))[0]?.progress).toBe(4);
      });

      it('é tudo ou nada: falha numa entrada não deixa a partida marcada nem grava nada', async () => {
        await setup();
        const a = await user('Ana');
        const m = await match([a.id]);
        await expect(
          h.progression.applyMatchProgress(m, [delta(a.id), delta(LAST_GHOST)]),
        ).rejects.toBeInstanceOf(InvalidInputError);
        expect(await h.progression.getStats(a.id)).toEqual([]);
        // A marca foi desfeita junto: uma nova tentativa válida aplica.
        const retry = await h.progression.applyMatchProgress(m, [delta(a.id)]);
        expect(retry.applied).toBe(true);
      });

      it('partida inexistente é recusada', async () => {
        await setup();
        const a = await user('Ana');
        await expect(h.progression.applyMatchProgress(GHOST, [delta(a.id)])).rejects.toBeInstanceOf(
          InvalidInputError,
        );
      });
    });

    describe('conquistas', () => {
      it('nível sobe com o progresso, guarda o 1º desbloqueio e nunca diminui', async () => {
        await setup();
        const a = await user('Ana');
        const m1 = await match([a.id]);
        const m2 = await match([a.id]);
        const m3 = await match([a.id]);
        const at = new Date('2026-11-04T10:00:00Z');
        await h.progression.applyMatchProgress(m1, [
          delta(a.id, {
            achievements: [{ achievementId: 'zap_na_mao', progressDelta: 1, unlockedAt: at }],
          }),
        ]);
        const r2 = await h.progression.applyMatchProgress(m2, [
          delta(a.id, { achievements: [{ achievementId: 'zap_na_mao', progressDelta: 24 }] }),
        ]);
        expect(r2.unlocked).toEqual([
          { userId: a.id, achievementId: 'zap_na_mao', previousLevel: 1, level: 2, progress: 25 },
        ]);
        // Sem nível novo: não reporta desbloqueio.
        const r3 = await h.progression.applyMatchProgress(m3, [
          delta(a.id, { achievements: [{ achievementId: 'zap_na_mao', progressSet: 3 }] }),
        ]);
        expect(r3.unlocked).toEqual([]);
        const [row] = await h.progression.listAchievements(a.id);
        // `progressSet` só sobe (GREATEST): 3 < 25 não rebaixa o progresso.
        expect(row).toMatchObject({ achievementId: 'zap_na_mao', level: 2, progress: 25 });
        expect(row?.unlockedAt?.toISOString()).toBe(at.toISOString());
      });

      it('progressSet nunca regride, nem em partidas simultâneas com valores diferentes', async () => {
        await setup();
        const a = await user('Ana');
        const ms = await Promise.all([1, 2, 3, 4, 5].map(() => match([a.id])));
        const sets = [4, 9, 2, 7, 5];
        await Promise.all(
          ms.map((m, i) =>
            h.progression.applyMatchProgress(m, [
              delta(a.id, {
                achievements: [{ achievementId: 'dupla_afinada', progressSet: sets[i] as number }],
              }),
            ]),
          ),
        );
        const [row] = await h.progression.listAchievements(a.id);
        expect(row).toMatchObject({ achievementId: 'dupla_afinada', progress: 9, level: 1 });
        const m = await match([a.id]);
        await h.progression.applyMatchProgress(m, [
          delta(a.id, {
            achievements: [{ achievementId: 'dupla_afinada', progressSet: 1 }],
          }),
        ]);
        expect((await h.progression.listAchievements(a.id))[0]?.progress).toBe(9);
      });

      it('progresso abaixo do 1º degrau fica com nível 0 e sem data', async () => {
        await setup();
        const a = await user('Ana');
        const m = await match([a.id]);
        await h.progression.applyMatchProgress(m, [
          delta(a.id, { achievements: [{ achievementId: 'maratona', progressDelta: 3 }] }),
        ]);
        expect(await h.progression.listAchievements(a.id)).toEqual([
          { achievementId: 'maratona', level: 0, progress: 3, unlockedAt: null },
        ]);
        // Perfil público só mostra o desbloqueado.
        expect((await h.progression.getPublicProfile(a.id))?.achievements).toEqual([]);
      });
    });

    describe('missões', () => {
      it('progresso não passa da meta e a conclusão é reportada uma única vez', async () => {
        await setup();
        const a = await user('Ana');
        const m1 = await match([a.id]);
        const m2 = await match([a.id]);
        const mission = {
          missionId: 'jogar_3_partidas',
          periodKey: DAY,
          target: 3,
          progressDelta: 2,
        } as const;
        const r1 = await h.progression.applyMatchProgress(m1, [
          delta(a.id, { missions: [mission] }),
        ]);
        expect(r1.missionsCompleted).toEqual([]);
        const r2 = await h.progression.applyMatchProgress(m2, [
          delta(a.id, { missions: [mission] }),
        ]);
        expect(r2.missionsCompleted).toEqual([
          { userId: a.id, missionId: 'jogar_3_partidas', periodKey: DAY },
        ]);
        const [row] = await h.progression.listMissions(a.id, [DAY]);
        expect(row).toMatchObject({ progress: 3, target: 3 });
        expect(row?.completedAt).toBeInstanceOf(Date);
        const m3 = await match([a.id]);
        const r3 = await h.progression.applyMatchProgress(m3, [
          delta(a.id, { missions: [mission] }),
        ]);
        expect(r3.missionsCompleted).toEqual([]);
        expect((await h.progression.listMissions(a.id, [DAY]))[0]?.progress).toBe(3);
      });

      it('a meta gravada não muda e dias diferentes são linhas diferentes', async () => {
        await setup();
        const a = await user('Ana');
        const m1 = await match([a.id]);
        const m2 = await match([a.id]);
        await h.progression.applyMatchProgress(m1, [
          delta(a.id, {
            missions: [
              { missionId: 'vencer_1_partida', periodKey: DAY, target: 1, progressDelta: 1 },
            ],
          }),
        ]);
        await h.progression.applyMatchProgress(m2, [
          delta(a.id, {
            missions: [
              { missionId: 'vencer_1_partida', periodKey: NEXT_DAY, target: 5, progressDelta: 1 },
              { missionId: 'vencer_5_semana', periodKey: WEEK, target: 5, progressDelta: 1 },
            ],
          }),
        ]);
        expect(await h.progression.listMissions(a.id, [DAY])).toHaveLength(1);
        expect(await h.progression.listMissions(a.id, [NEXT_DAY, WEEK])).toHaveLength(2);
        expect(await h.progression.listMissions(a.id, [DAY, NEXT_DAY, WEEK])).toHaveLength(3);
        expect(await h.progression.listMissions(a.id, ['2026-11-06'])).toEqual([]);
      });
    });

    describe('ensureMissions', () => {
      it('cria as linhas que faltam, é idempotente e não altera meta nem progresso', async () => {
        await setup();
        const a = await user('Ana');
        const defs = [
          { missionId: 'jogar_3_partidas', target: 3 },
          { missionId: 'vencer_1_partida', target: 1 },
        ] as const;
        const first = await h.progression.ensureMissions(a.id, DAY, defs);
        expect(first.map((r) => [r.missionId, r.target, r.progress, r.completedAt])).toEqual([
          ['jogar_3_partidas', 3, 0, null],
          ['vencer_1_partida', 1, 0, null],
        ]);
        const m = await match([a.id]);
        await h.progression.applyMatchProgress(m, [
          delta(a.id, {
            missions: [
              { missionId: 'jogar_3_partidas', periodKey: DAY, target: 3, progressDelta: 1 },
            ],
          }),
        ]);
        const again = await h.progression.ensureMissions(a.id, DAY, [
          { missionId: 'jogar_3_partidas', target: 99 },
          { missionId: 'usar_5_sinais', target: 5 },
        ]);
        expect(again.map((r) => [r.missionId, r.target, r.progress])).toEqual([
          ['jogar_3_partidas', 3, 1],
          ['usar_5_sinais', 5, 0],
          ['vencer_1_partida', 1, 0],
        ]);
      });

      it('chamadas simultâneas não duplicam', async () => {
        await setup();
        const a = await user('Ana');
        const defs = [{ missionId: 'pedir_truco_3', target: 3 }] as const;
        const all = await Promise.all(
          Array.from({ length: 5 }, () => h.progression.ensureMissions(a.id, DAY, defs)),
        );
        for (const rows of all) expect(rows).toHaveLength(1);
        expect(await h.progression.listMissions(a.id, [DAY])).toHaveLength(1);
      });

      it('ordem do catálogo (não alfabética) e lista vazia para usuário inexistente', async () => {
        await setup();
        const a = await user('Ana');
        const rows = await h.progression.ensureMissions(a.id, DAY, [
          { missionId: 'jogar_3_partidas', target: 3 },
          { missionId: 'vencer_1_partida', target: 1 },
          { missionId: 'pedir_truco_3', target: 3 },
          { missionId: 'aceitar_2_aumentos', target: 2 },
          { missionId: 'usar_5_sinais', target: 5 },
        ]);
        expect(rows).toHaveLength(5);
        expect(await h.progression.ensureMissions(GHOST, DAY, [])).toEqual([]);
      });

      it('usuário inexistente e entrada inválida são recusados', async () => {
        await setup();
        const a = await user('Ana');
        const defs = [{ missionId: 'pedir_truco_3', target: 3 }] as const;
        await expect(h.progression.ensureMissions(GHOST, DAY, defs)).rejects.toBeInstanceOf(
          InvalidInputError,
        );
        await expect(h.progression.ensureMissions(a.id, '2026-1-4', defs)).rejects.toBeInstanceOf(
          InvalidInputError,
        );
        await expect(
          h.progression.ensureMissions(a.id, DAY, [{ missionId: 'x' as never, target: 1 }]),
        ).rejects.toBeInstanceOf(InvalidInputError);
        await expect(
          h.progression.ensureMissions(a.id, DAY, [{ missionId: 'pedir_truco_3', target: 0 }]),
        ).rejects.toBeInstanceOf(InvalidInputError);
      });
    });

    describe('estatísticas e perfil público', () => {
      it('conta por variante e monta o perfil sem progresso nem datas', async () => {
        await setup();
        const a = await user('Ana');
        const m1 = await match([a.id]);
        const m2 = await match([a.id]);
        await h.progression.applyMatchProgress(m1, [
          delta(a.id, { achievements: [{ achievementId: 'primeira_vitoria', progressDelta: 1 }] }),
        ]);
        await h.progression.applyMatchProgress(m2, [delta(a.id, { variant: 'mineiro', won: 0 })]);
        expect(await h.progression.getStats(a.id)).toEqual([
          { variant: 'mineiro', played: 1, won: 0 },
          { variant: 'paulista', played: 1, won: 1 },
        ]);
        expect(await h.progression.getPublicProfile(a.id)).toEqual({
          userId: a.id,
          nickname: 'Ana',
          avatar: null,
          achievements: [{ achievementId: 'primeira_vitoria', level: 1 }],
          stats: [
            { variant: 'mineiro', played: 1, won: 0 },
            { variant: 'paulista', played: 1, won: 1 },
          ],
        });
        expect(await h.progression.getPublicProfile(GHOST)).toBeNull();
      });
    });

    describe('countWinsTogether', () => {
      it('conta só partidas JÁ aplicadas (progression_applied), finished, vencidas pela dupla e sem bot', async () => {
        await setup();
        const a = await user('Ana');
        const b = await user('Beto');
        const c = await user('Caio');
        const d = await user('Duda');
        const four = [a.id, b.id, c.id, d.id];
        // Ana (0) e Caio (2) são dupla; Beto (1) e Duda (3) são a outra. A dupla 0 vence por padrão.
        const apply = (id: string): Promise<unknown> =>
          h.progression.applyMatchProgress(id, [delta(a.id)]);
        const m1 = await match(four);
        const m2 = await match(four);
        await apply(m1);
        await apply(m2);
        // Gravada mas NÃO aplicada (anterior ao 6D, ou a que está sendo avaliada agora): não entra.
        await match(four);
        // Vitória da dupla 1 (Beto e Duda), aplicada: Ana e Caio perderam.
        const lost = await h.matches.saveMatch({ ...(await matchInput(four)), winnerTeam: 1 });
        await apply(lost);
        // Com bot em algum assento, aplicada ou não, não entra.
        const botInput = await matchInput(four);
        const withBot = await h.matches.saveMatch({
          ...botInput,
          players: botInput.players.map((p) => (p.seat === 3 ? { ...p, botFrom: 5 } : p)),
        });
        await apply(withBot);
        // Cancelada não conta.
        const cancelled = await h.matches.saveMatch({
          ...(await matchInput(four)),
          status: 'cancelled',
          winnerTeam: null,
        });
        await apply(cancelled);
        expect(await h.progression.countWinsTogether(a.id, c.id)).toBe(2);
        expect(await h.progression.countWinsTogether(c.id, a.id)).toBe(2);
        expect(await h.progression.countWinsTogether(b.id, d.id)).toBe(1);
        // Adversários nunca venceram juntos; o mesmo usuário consigo mesmo é zero.
        expect(await h.progression.countWinsTogether(a.id, b.id)).toBe(0);
        expect(await h.progression.countWinsTogether(a.id, a.id)).toBe(0);
        expect(await h.progression.countWinsTogether(a.id, GHOST)).toBe(0);
      });
    });

    describe('usuário apagado no meio', () => {
      it('um usuário inexistente recusa a aplicação inteira (quem chama refaz sem ele)', async () => {
        await setup();
        const a = await user('Ana');
        const b = await user('Beto');
        const m = await match([a.id, b.id]);
        await h.users.deleteUser(b.id);
        await expect(
          h.progression.applyMatchProgress(m, [delta(a.id), delta(b.id)]),
        ).rejects.toBeInstanceOf(InvalidInputError);
        // Nada foi gravado nem marcado: a nova tentativa só com quem existe aplica.
        expect(await h.progression.getStats(a.id)).toEqual([]);
        expect((await h.progression.applyMatchProgress(m, [delta(a.id)])).applied).toBe(true);
      });
    });

    describe('apagar usuário', () => {
      it('leva conquistas, missões e estatísticas; a de outro jogador fica', async () => {
        await setup();
        const a = await user('Ana');
        const b = await user('Beto');
        const m = await match([a.id, b.id]);
        const full = (id: string): UserProgressDelta =>
          delta(id, {
            achievements: [{ achievementId: 'primeira_vitoria', progressDelta: 1 }],
            missions: [
              { missionId: 'vencer_1_partida', periodKey: DAY, target: 1, progressDelta: 1 },
            ],
          });
        await h.progression.applyMatchProgress(m, [full(a.id), full(b.id)]);
        expect(await h.users.deleteUser(a.id)).toBe(true);
        expect(await h.progression.listAchievements(a.id)).toEqual([]);
        expect(await h.progression.listMissions(a.id, [DAY])).toEqual([]);
        expect(await h.progression.getStats(a.id)).toEqual([]);
        expect(await h.progression.getPublicProfile(a.id)).toBeNull();
        expect(await h.progression.listAchievements(b.id)).toHaveLength(1);
        expect(await h.progression.getStats(b.id)).toHaveLength(1);
        // Reprocessar a partida continua sem efeito (a marca é da partida, não do usuário).
        expect((await h.progression.applyMatchProgress(m, [full(b.id)])).applied).toBe(false);
        // Com o usuário apagado na lista (A), a partida já aplicada continua applied:false, sem erro.
        expect((await h.progression.applyMatchProgress(m, [full(a.id), full(b.id)])).applied).toBe(
          false,
        );
      });
    });

    describe('entrada inválida', () => {
      it('recusa o que o banco recusaria', async () => {
        await setup();
        const a = await user('Ana');
        const m = await match([a.id]);
        const bad: readonly (readonly [string, UserProgressDelta])[] = [
          ['won maior que played', delta(a.id, { played: 1, won: 2 })],
          ['played negativo', delta(a.id, { played: -1, won: 0 })],
          ['played fracionário', delta(a.id, { played: 1.5, won: 0 })],
          [
            'conquista fora do catálogo',
            delta(a.id, {
              achievements: [{ achievementId: 'nao_existe' as never, progressDelta: 1 }],
            }),
          ],
          [
            'delta negativo',
            delta(a.id, { achievements: [{ achievementId: 'maratona', progressDelta: -1 }] }),
          ],
          [
            'delta e set juntos',
            delta(a.id, {
              achievements: [{ achievementId: 'maratona', progressDelta: 1, progressSet: 1 }],
            }),
          ],
          ['nem delta nem set', delta(a.id, { achievements: [{ achievementId: 'maratona' }] })],
          [
            'conquista repetida',
            delta(a.id, {
              achievements: [
                { achievementId: 'maratona', progressDelta: 1 },
                { achievementId: 'maratona', progressDelta: 1 },
              ],
            }),
          ],
          [
            'periodKey inválido',
            delta(a.id, {
              missions: [
                {
                  missionId: 'vencer_1_partida',
                  periodKey: '04/11/2026',
                  target: 1,
                  progressDelta: 1,
                },
              ],
            }),
          ],
          [
            'meta zero',
            delta(a.id, {
              missions: [
                { missionId: 'vencer_1_partida', periodKey: DAY, target: 0, progressDelta: 1 },
              ],
            }),
          ],
          [
            'missão fora do catálogo',
            delta(a.id, {
              missions: [{ missionId: 'x' as never, periodKey: DAY, target: 1, progressDelta: 1 }],
            }),
          ],
          ['variante inválida', delta(a.id, { variant: 'truco' as never })],
          ['userId que não é UUID', delta('xyz')],
        ];
        for (const [label, d] of bad) {
          await expect(h.progression.applyMatchProgress(m, [d]), label).rejects.toBeInstanceOf(
            InvalidInputError,
          );
        }
        await expect(
          h.progression.applyMatchProgress(m, [delta(a.id), delta(a.id)]),
        ).rejects.toBeInstanceOf(InvalidInputError);
        // Nenhuma recusa deixou a partida marcada.
        expect((await h.progression.applyMatchProgress(m, [delta(a.id)])).applied).toBe(true);
      });
    });
  });
}
