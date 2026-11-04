import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrisma, type PrismaHandle } from './prisma';
import { PrismaProgressionRepository } from './prismaProgression';
import { PrismaMatchRepository, PrismaUserRepository } from './prismaRepositories';
import { progressionContract } from './progressionContract';
import { assertSafeTestDatabaseUrl } from './testDatabase';

/**
 * Progressão contra Postgres real (`pnpm test:int`, bloco 6C). Mesmo contrato da memória
 * (`progressionContract`) mais o que só o banco garante: CHECKs, cascata, índice. Banco DESCARTÁVEL já
 * migrado (`pnpm db:deploy`); a trava recusa host não local e nome sem "test"/"verif".
 */
const url = process.env['TEST_DATABASE_URL'];
const enabled = url !== undefined && url !== '';

let handle: PrismaHandle | undefined;
if (enabled) handle = createPrisma(assertSafeTestDatabaseUrl(url), { maxConnections: 8 });

const prisma = (): PrismaHandle['prisma'] => {
  if (handle === undefined) throw new Error('sem banco');
  return handle.prisma;
};

afterAll(async () => {
  await handle?.close();
});

if (enabled) {
  progressionContract('Postgres', () => ({
    users: new PrismaUserRepository(prisma()),
    matches: new PrismaMatchRepository(prisma()),
    progression: new PrismaProgressionRepository(prisma()),
    reset: async () => {
      await prisma().$executeRawUnsafe(
        'TRUNCATE TABLE progression_applied, user_stats, user_missions, user_achievements, reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
      );
    },
  }));
}

describe.skipIf(!enabled)('progressão: regras do banco (CHECKs, cascata, índice)', () => {
  let userId = '';
  let matchId = '';

  beforeAll(async () => {
    await prisma().$executeRawUnsafe(
      'TRUNCATE TABLE progression_applied, user_stats, user_missions, user_achievements, reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
    );
    const user = await new PrismaUserRepository(prisma()).createGuest({
      providerSubject: 'check-1',
      nickname: 'Checker',
    });
    userId = user.id;
    const m = await prisma().$queryRaw<{ id: string }[]>`
      INSERT INTO matches (id, variant, format, iron_hand, visibility, seed, options, events, games,
        status, winner_team, started_at, ended_at)
      VALUES (gen_random_uuid(), 'paulista', 'single', false, 'public', 1, '{}', '[]', '[]',
        'finished', 0, now(), now())
      RETURNING id`;
    matchId = m[0]?.id ?? '';
  });

  const failsWith = async (sql: Promise<unknown>, name: string): Promise<void> => {
    await expect(sql).rejects.toThrow(new RegExp(name));
  };

  it('user_stats: played >= won >= 0', async () => {
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_stats (user_id, variant, played, won)
        VALUES (${userId}::uuid, 'paulista', 1, 2)`,
      'user_stats_played_check',
    );
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_stats (user_id, variant, played, won)
        VALUES (${userId}::uuid, 'paulista', -1, -2)`,
      'user_stats_(won|played)_check',
    );
  });

  it('user_achievements: progress >= 0, level >= 0 e level > 0 exige unlocked_at', async () => {
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_achievements (user_id, achievement_id, progress)
        VALUES (${userId}::uuid, 'maratona', -1)`,
      'user_achievements_progress_check',
    );
    await failsWith(
      prisma()
        .$executeRaw`INSERT INTO user_achievements (user_id, achievement_id, level, unlocked_at)
        VALUES (${userId}::uuid, 'maratona', -1, now())`,
      'user_achievements_(level|unlock)_check',
    );
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_achievements (user_id, achievement_id, level)
        VALUES (${userId}::uuid, 'maratona', 1)`,
      'user_achievements_unlock_check',
    );
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_achievements (user_id, achievement_id)
        VALUES (${userId}::uuid, '')`,
      'user_achievements_id_check',
    );
    await failsWith(
      prisma().$executeRaw`INSERT INTO user_achievements (user_id, achievement_id)
        VALUES (${userId}::uuid, ${'x'.repeat(41)})`,
      'value too long',
    );
  });

  it('user_missions: meta positiva, 0 <= progress <= target e period_key no formato', async () => {
    const insert = (key: string, target: number, progress: number): Promise<number> =>
      prisma()
        .$executeRaw`INSERT INTO user_missions (user_id, mission_id, period_key, target, progress)
        VALUES (${userId}::uuid, 'jogar_3_partidas', ${key}, ${target}, ${progress})`;
    await failsWith(insert('2026-11-04', 0, 0), 'user_missions_target_check');
    await failsWith(insert('2026-11-04', 3, 4), 'user_missions_progress_check');
    await failsWith(insert('2026-11-04', 3, -1), 'user_missions_progress_check');
    await failsWith(insert('2026-W5', 3, 0), 'user_missions_period_key_(length|format)_check');
    await failsWith(insert('04/11/2026', 3, 0), 'user_missions_period_key_(length|format)_check');
    await failsWith(insert('2026-11-04x', 3, 0), 'user_missions_period_key_format_check');
    await failsWith(
      insert('2026-11-04-0900', 3, 0),
      'user_missions_period_key_(length|format)_check',
    );
    await failsWith(insert('x'.repeat(17), 3, 0), 'value too long');
    expect(await insert('2026-11-04', 3, 3)).toBe(1);
    expect(await insert('2026-W45', 5, 0)).toBe(1);
    await failsWith(insert('2026-11-04', 3, 0), 'user_missions_pkey');
  });

  it('FKs: usuário e partida inexistentes são recusados', async () => {
    const ghost = '00000000-0000-4000-8000-000000000000';
    await failsWith(
      prisma()
        .$executeRaw`INSERT INTO user_stats (user_id, variant) VALUES (${ghost}::uuid, 'mineiro')`,
      'user_stats_user_id_fkey',
    );
    await failsWith(
      prisma().$executeRaw`INSERT INTO progression_applied (match_id) VALUES (${ghost}::uuid)`,
      'progression_applied_match_id_fkey',
    );
  });

  it('DELETE FROM users apaga a progressão por cascata; DELETE FROM matches apaga a marca', async () => {
    await prisma()
      .$executeRaw`INSERT INTO progression_applied (match_id) VALUES (${matchId}::uuid)`;
    await prisma()
      .$executeRaw`INSERT INTO user_stats (user_id, variant) VALUES (${userId}::uuid, 'mineiro')`;
    await prisma().$executeRaw`INSERT INTO user_achievements (user_id, achievement_id)
      VALUES (${userId}::uuid, 'sinaleiro')`;
    await prisma().$executeRaw`DELETE FROM matches WHERE id = ${matchId}::uuid`;
    const marks = await prisma().$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM progression_applied`;
    expect(Number(marks[0]?.n)).toBe(0);
    await prisma().$executeRaw`DELETE FROM users WHERE id = ${userId}::uuid`;
    for (const table of ['user_stats', 'user_missions', 'user_achievements']) {
      const rows = await prisma().$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM ${table}`,
      );
      expect(Number(rows[0]?.n), table).toBe(0);
    }
  });

  it('índice (user_id, period_key) existe (atende listMissions)', async () => {
    const idx = await prisma().$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'user_missions_user_id_period_key_idx'`;
    expect(idx[0]?.indexdef).toContain('(user_id, period_key)');
  });
});
