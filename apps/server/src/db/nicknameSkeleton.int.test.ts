/**
 * Esqueleto do apelido contra Postgres REAL: o `translate()` do SQL tem de dar o mesmo resultado que o
 * `nicknameSkeleton` do TypeScript (a tabela vai como parâmetro).
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPrisma, type PrismaHandle } from './prisma';
import { PrismaUserRepository } from './prismaRepositories';
import { assertSafeTestDatabaseUrl } from './testDatabase';
import { NicknameTakenError } from './types';
import { SKELETON_TRANSLATE_FROM, SKELETON_TRANSLATE_TO, nicknameSkeleton } from './validation';

const url = process.env['TEST_DATABASE_URL'];
const enabled = url !== undefined && url !== '';
let handle: PrismaHandle | undefined;
if (enabled) handle = createPrisma(assertSafeTestDatabaseUrl(url), { maxConnections: 4 });
const prisma = (): PrismaHandle['prisma'] => {
  if (handle === undefined) throw new Error('sem banco');
  return handle.prisma;
};
afterAll(async () => {
  await handle?.close();
});
beforeEach(async () => {
  if (!enabled) return;
  await prisma().$executeRawUnsafe(
    'TRUNCATE TABLE progression_applied, user_stats, user_missions, user_achievements, reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
  );
});

describe.skipIf(!enabled)('esqueleto do apelido (Postgres)', () => {
  it('SQL e TypeScript concordam para todos os caracteres da tabela e para acentos do português', async () => {
    const samples = [
      ...[...SKELETON_TRANSLATE_FROM],
      'Mıguel',
      'İsmail',
      'Łukasz',
      'João',
      'Conceição',
      'Ø',
      'ABCxyz_.-09',
    ];
    for (const s of samples) {
      const rows = await prisma().$queryRaw<{ sk: string }[]>`
        SELECT lower(translate(${s}, ${SKELETON_TRANSLATE_FROM}, ${SKELETON_TRANSLATE_TO})) AS sk`;
      expect(rows[0]?.sk, s).toBe(nicknameSkeleton(s));
    }
  });

  it('updateNickname recusa letra parecida de outro jogador, aceita acento do português e a si mesmo', async () => {
    const users = new PrismaUserRepository(prisma());
    const a = await users.createGuest({ providerSubject: 'a', nickname: 'Miguel' });
    const b = await users.createGuest({ providerSubject: 'b', nickname: 'Visitante1' });
    await expect(users.updateNickname(b.id, 'Mıguel')).rejects.toBeInstanceOf(NicknameTakenError);
    await expect(users.updateNickname(b.id, 'MIGUEL')).rejects.toBeInstanceOf(NicknameTakenError);
    await expect(users.updateNickname(b.id, 'Mig0el')).resolves.toBeUndefined();
    await expect(users.updateNickname(b.id, 'Ivo')).resolves.toBeUndefined();
    const c = await users.createGuest({ providerSubject: 'c', nickname: 'Visitante2' });
    await expect(users.updateNickname(c.id, 'lvo')).rejects.toBeInstanceOf(NicknameTakenError);
    await users.updateNickname(b.id, 'Miguéu');
    await users.updateNickname(a.id, 'Mıguel'); // a própria conta não colide consigo
    expect((await users.findById(a.id))?.nickname).toBe('Mıguel');
    await expect(users.updateNickname(b.id, 'Miguel')).rejects.toBeInstanceOf(NicknameTakenError);
  });

  it('criar também respeita o índice: apelido de esqueleto já usado dá NICKNAME_TAKEN (sem corrida)', async () => {
    const users = new PrismaUserRepository(prisma());
    await users.createGuest({ providerSubject: 'x', nickname: 'Pedro' });
    await expect(
      users.createGuest({ providerSubject: 'y', nickname: 'Pedrø' }),
    ).rejects.toBeInstanceOf(NicknameTakenError);
  });

  it('a unicidade é do índice (atômica): duas trocas simultâneas para o mesmo esqueleto, só uma passa', async () => {
    const users = new PrismaUserRepository(prisma());
    const ids = [];
    for (let i = 0; i < 6; i++) {
      ids.push((await users.createGuest({ providerSubject: `r${i}`, nickname: `Corre${i}x` })).id);
    }
    const names = ['Mıguel', 'Miguel', 'MiGUEL', 'Mıguel', 'Miguel', 'MiGuEl'];
    const results = await Promise.allSettled(
      ids.map((id, i) => users.updateNickname(id, names[i] as string)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(NicknameTakenError);
    }
  });

  it('a migração renomeia colisões antigas sem apagar usuário e cria o índice', async () => {
    const db = prisma();
    const sql = readFileSync(
      new URL(
        '../../prisma/migrations/20261106120000_nickname_skeleton/migration.sql',
        import.meta.url,
      ),
      'utf8',
    );
    await db.$executeRawUnsafe('DROP INDEX IF EXISTS users_nickname_skeleton_key');
    // legado: apelidos fora da política atual, mas aceitos pelo CHECK do banco
    await db.$executeRawUnsafe(`
      INSERT INTO users (id, provider, provider_subject, nickname, created_at, last_seen_at) VALUES
      ('00000000-0000-4000-8000-000000000001','guest','m1','Leo','2026-01-01','2026-01-01'),
      ('00000000-0000-4000-8000-000000000002','guest','m2','ǀeo','2026-02-01','2026-02-01'),
      ('00000000-0000-4000-8000-000000000003','guest','m3','Ivo','2026-03-01','2026-03-01'),
      ('00000000-0000-4000-8000-000000000004','guest','m4','lvo','2026-04-01','2026-04-01'),
      ('00000000-0000-4000-8000-000000000005','guest','m5','Unico','2026-05-01','2026-05-01')`);
    const statements = sql
      .split(/;\s*\n/)
      .map((x) => x.trim())
      .filter((x) => x.replace(/--.*$/gm, '').trim() !== '');
    for (const st of statements) await db.$executeRawUnsafe(st);
    const rows = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: { nickname: true },
    });
    expect(rows).toHaveLength(5); // ninguém foi apagado
    expect(rows.map((r) => r.nickname)).toEqual([
      'Leo',
      expect.stringMatching(/^Jogador[0-9a-f]{8}$/),
      'Ivo',
      expect.stringMatching(/^Jogador[0-9a-f]{8}$/),
      'Unico',
    ]);
    const idx = await db.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM pg_indexes WHERE indexname = 'users_nickname_skeleton_key'`;
    expect(Number(idx[0]?.n)).toBe(1);
  });
});
