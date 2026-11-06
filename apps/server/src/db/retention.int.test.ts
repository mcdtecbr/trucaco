/**
 * Retenção contra Postgres REAL (`pnpm test:int`, banco DESCARTÁVEL já migrado). Confere cada passo, o que
 * NÃO pode ser apagado, as cascatas, os lotes e o log sem dado pessoal.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setLogSink } from '../logger';
import { dayKey, weekKey } from '../progression/period';
import { createPrisma, type PrismaHandle } from './prisma';
import { PrismaMatchRepository, PrismaUserRepository } from './prismaRepositories';
import { runRetention, startRetentionJob } from './retention';
import { assertSafeTestDatabaseUrl } from './testDatabase';
import type { FinishedMatchInput } from './types';

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

const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * DAY);

const match = (
  ids: (string | null)[],
  endedAt: Date,
  extra: Partial<FinishedMatchInput> = {},
): FinishedMatchInput => ({
  variant: 'paulista',
  format: 'single',
  ironHand: true,
  visibility: 'public',
  roomCode: null,
  seed: 1,
  options: {},
  events: [{ seq: 1, at: 1, event: { type: 'handStarted' } }],
  deals: [{ hand: 1, cards: ['4C'] }],
  winnerTeam: 0,
  games: [{ score: [12, 8] }],
  status: 'finished',
  startedAt: new Date(endedAt.getTime() - 60_000),
  endedAt,
  players: ids.map((userId, seat) => ({
    seat,
    userId,
    team: (seat % 2) as 0 | 1,
    botFrom: userId === null ? 0 : null,
  })),
  ...extra,
});

let seq = 0;
async function setup() {
  const db = prisma();
  const users = new PrismaUserRepository(db);
  const matches = new PrismaMatchRepository(db);
  /** Convidado com `last_seen_at` N dias atrás. */
  const guest = async (lastSeenDaysAgo: number, nickname = `Conv${++seq}`) => {
    const u = await users.createGuest({ providerSubject: `g-${seq}-${nickname}`, nickname });
    const at = daysAgo(lastSeenDaysAgo).toISOString();
    await db.$executeRaw`UPDATE users SET last_seen_at = ${at}::timestamptz WHERE id = ${u.id}::uuid`;
    return u;
  };
  const count = async (table: string): Promise<number> => {
    const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM ${table}`);
    return Number(rows[0]?.n ?? 0);
  };
  const exists = async (id: string): Promise<boolean> => (await users.findById(id)) !== null;
  return { db, users, matches, guest, count, exists };
}

beforeEach(async () => {
  if (!enabled) return;
  await prisma().$executeRawUnsafe(
    'TRUNCATE TABLE progression_applied, user_stats, user_missions, user_achievements, reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
  );
});

describe.skipIf(!enabled)('retenção (Postgres)', () => {
  it('deals: zerado após 30 dias, só nesses; events e a linha ficam', async () => {
    const { db, matches } = await setup();
    const old = await matches.saveMatch(match([null, null, null, null], daysAgo(40)));
    const recent = await matches.saveMatch(match([null, null, null, null], daysAgo(10)));
    const result = await runRetention(db, NOW);
    expect(result.dealsCleared).toBe(1);
    const rows = await db.match.findMany({ select: { id: true, deals: true, events: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(old)?.deals).toBeNull();
    expect(byId.get(old)?.events).not.toBeNull();
    expect(byId.get(recent)?.deals).not.toBeNull();
    expect((await runRetention(db, NOW)).dealsCleared).toBe(0); // idempotente
  });

  it('partida cancelada some em 30 dias; terminada de 40 dias fica (sem deals); de 13 meses some com os assentos', async () => {
    const { db, matches, count, guest } = await setup();
    const a = await guest(1);
    const cancelledOld = await matches.saveMatch(
      match([a.id, null, null, null], daysAgo(40), { status: 'cancelled', winnerTeam: null }),
    );
    const cancelledRecent = await matches.saveMatch(
      match([null, null, null, null], daysAgo(5), { status: 'cancelled', winnerTeam: null }),
    );
    const finished40 = await matches.saveMatch(match([a.id, null, null, null], daysAgo(40)));
    const finished13m = await matches.saveMatch(match([a.id, null, null, null], daysAgo(400)));
    const result = await runRetention(db, NOW);
    expect(result.cancelledDeleted).toBe(1);
    expect(result.matchesDeleted).toBe(1);
    const ids = new Set((await db.match.findMany({ select: { id: true } })).map((m) => m.id));
    expect(ids.has(cancelledOld)).toBe(false);
    expect(ids.has(cancelledRecent)).toBe(true);
    expect(ids.has(finished40)).toBe(true);
    expect(ids.has(finished13m)).toBe(false);
    // `match_players` das partidas apagadas sumiram junto (cascata); as 2 restantes têm 4 assentos cada
    expect(await count('match_players')).toBe(8);
    expect(await count('matches')).toBe(2);
  });

  it('denúncia sobrevive ao expurgo da partida (match_id vira NULL)', async () => {
    const { db, matches, guest } = await setup();
    const a = await guest(1);
    const b = await guest(1);
    const old = await matches.saveMatch(match([a.id, b.id, null, null], daysAgo(400)));
    await db.$executeRaw`
      INSERT INTO reports (id, reporter_id, reported_id, match_id, reason, status)
      VALUES (gen_random_uuid(), ${a.id}::uuid, ${b.id}::uuid, ${old}::uuid, 'other', 'reviewed')`;
    await runRetention(db, NOW);
    const rows = await db.report.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.matchId).toBeNull();
    expect(rows[0]?.reporterId).toBe(a.id);
  });

  it('partida citada por denúncia ABERTA fica (deals, cancelada e antiga); fechada segue a regra', async () => {
    const { db, matches, guest } = await setup();
    const a = await guest(1);
    const b = await guest(1);
    const dealsOpen = await matches.saveMatch(match([a.id, b.id, null, null], daysAgo(40)));
    const cancelledOpen = await matches.saveMatch(
      match([a.id, b.id, null, null], daysAgo(40), { status: 'cancelled', winnerTeam: null }),
    );
    const oldOpen = await matches.saveMatch(match([a.id, b.id, null, null], daysAgo(400)));
    const oldClosed = await matches.saveMatch(match([a.id, b.id, null, null], daysAgo(401)));
    const dealsClosed = await matches.saveMatch(match([a.id, b.id, null, null], daysAgo(41)));
    await db.$executeRaw`
      INSERT INTO reports (id, reporter_id, reported_id, match_id, reason, status) VALUES
      (gen_random_uuid(), ${a.id}::uuid, ${b.id}::uuid, ${dealsOpen}::uuid, 'cheating', 'open'),
      (gen_random_uuid(), ${b.id}::uuid, ${a.id}::uuid, ${cancelledOpen}::uuid, 'cheating', 'open'),
      (gen_random_uuid(), ${a.id}::uuid, ${b.id}::uuid, ${oldOpen}::uuid, 'other', 'open'),
      (gen_random_uuid(), ${a.id}::uuid, ${b.id}::uuid, ${oldClosed}::uuid, 'other', 'dismissed'),
      (gen_random_uuid(), ${b.id}::uuid, ${a.id}::uuid, ${dealsClosed}::uuid, 'other', 'reviewed')`;
    const result = await runRetention(db, NOW);
    expect(result).toMatchObject({ dealsCleared: 2, cancelledDeleted: 0, matchesDeleted: 1 });
    const rows = await db.match.findMany({ select: { id: true, deals: true } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(dealsOpen)?.deals).not.toBeNull(); // evidência preservada
    expect(byId.has(cancelledOpen)).toBe(true);
    expect(byId.has(oldOpen)).toBe(true);
    expect(byId.has(oldClosed)).toBe(false);
    expect(byId.get(dealsClosed)?.deals).toBeNull();
    // tratada a denúncia, o expurgo normal volta a valer
    await db.$executeRaw`UPDATE reports SET status = 'dismissed' WHERE status = 'open'`;
    const next = await runRetention(db, NOW);
    expect(next).toMatchObject({ dealsCleared: 3, cancelledDeleted: 1, matchesDeleted: 1 });
  });

  it('convidados: só o inativo SEM partida, estatística, conquista com progresso nem denúncia aberta', async () => {
    const { db, matches, guest, exists, count } = await setup();
    const idle = await guest(120);
    const recent = await guest(10);
    const withMatch = await guest(120);
    await matches.saveMatch(match([withMatch.id, null, null, null], daysAgo(3)));
    const withStats = await guest(120);
    await db.userStat.create({ data: { userId: withStats.id, variant: 'paulista', played: 1 } });
    const withAchievement = await guest(120);
    await db.userAchievement.create({
      data: { userId: withAchievement.id, achievementId: 'first_win', level: 0, progress: 2 },
    });
    const emptyAchievement = await guest(120);
    await db.userAchievement.create({
      data: { userId: emptyAchievement.id, achievementId: 'first_win', level: 0, progress: 0 },
    });
    const reportedOpen = await guest(120);
    const reportedClosed = await guest(120);
    const reporter = await guest(1);
    await db.$executeRaw`
      INSERT INTO reports (id, reporter_id, reported_id, reason, status)
      VALUES (gen_random_uuid(), ${reporter.id}::uuid, ${reportedOpen.id}::uuid, 'other', 'open'),
             (gen_random_uuid(), ${reporter.id}::uuid, ${reportedClosed.id}::uuid, 'other', 'dismissed')`;
    const social = await db.user.create({
      data: { provider: 'google', providerSubject: 'sub-velho', nickname: 'Social1' },
    });
    await db.$executeRaw`UPDATE users SET last_seen_at = ${daysAgo(300).toISOString()}::timestamptz WHERE id = ${social.id}::uuid`;
    const linkedGuest = await guest(120);
    await db.$executeRaw`UPDATE users SET linked_at = now() WHERE id = ${linkedGuest.id}::uuid`;

    const result = await runRetention(db, NOW);
    expect(result.guestsDeleted).toBe(3); // idle, emptyAchievement, reportedClosed

    expect(await exists(idle.id)).toBe(false);
    expect(await exists(emptyAchievement.id)).toBe(false);
    expect(await exists(reportedClosed.id)).toBe(false);
    for (const keep of [
      recent,
      withMatch,
      withStats,
      withAchievement,
      reportedOpen,
      reporter,
      linkedGuest,
    ]) {
      expect(await exists(keep.id), keep.nickname).toBe(true);
    }
    expect((await db.user.findUnique({ where: { id: social.id } }))?.id).toBe(social.id);
    // a cascata levou as linhas de progresso vazias do convidado apagado; a denúncia fechada ficou, anonimizada
    expect(await count('user_achievements')).toBe(1);
    const closed = await db.report.findMany({ where: { status: 'dismissed' } });
    expect(closed).toHaveLength(1);
    expect(closed[0]?.reportedId).toBeNull();
  });

  it('missões: períodos com mais de 90 dias somem (diária e semanal); o resto fica', async () => {
    const { db, guest, count } = await setup();
    const u = await guest(1);
    const mk = (periodKey: string, missionId: string) =>
      db.userMission.create({ data: { userId: u.id, missionId, periodKey, target: 3 } });
    await mk(dayKey(daysAgo(100)), 'm_old_day');
    await mk(weekKey(daysAgo(100)), 'm_old_week');
    await mk(dayKey(daysAgo(120)), 'm_older_day');
    await mk(dayKey(daysAgo(80)), 'm_recent_day');
    await mk(weekKey(daysAgo(80)), 'm_recent_week');
    await mk(dayKey(NOW), 'm_today');
    await mk(weekKey(NOW), 'm_this_week');
    const result = await runRetention(db, NOW);
    expect(result.missionsDeleted).toBe(3);
    const left = (await db.userMission.findMany({ select: { missionId: true } }))
      .map((m) => m.missionId)
      .sort();
    expect(left).toEqual(['m_recent_day', 'm_recent_week', 'm_this_week', 'm_today']);
    expect(await count('user_missions')).toBe(4);
  });

  it('lotes: com lote 2, 5 convidados somem em 3 lotes; com teto de 1 lote, sobram os demais para o dia seguinte', async () => {
    const { db, guest, count } = await setup();
    for (let i = 0; i < 5; i++) await guest(200);
    const capped = await runRetention(db, NOW, { batchSize: 2, maxBatchesPerStep: 1 });
    expect(capped.guestsDeleted).toBe(2);
    expect(await count('users')).toBe(3);
    const rest = await runRetention(db, NOW, { batchSize: 2 });
    expect(rest.guestsDeleted).toBe(3);
    expect(await count('users')).toBe(0);
    expect((await runRetention(db, NOW, { batchSize: 2 })).guestsDeleted).toBe(0);
  });

  it('o job registra só contagens (sem apelido nem id) e não roda duas vezes ao mesmo tempo', async () => {
    const { db, guest } = await setup();
    const g = await guest(200, 'ApelidoSecreto');
    const lines: string[] = [];
    const restore = setLogSink((level, msg, f) => lines.push(JSON.stringify({ level, msg, ...f })));
    const job = startRetentionJob(db, { firstDelayMs: 3_600_000, intervalMs: 3_600_000 });
    try {
      const [a, b] = await Promise.all([job.runNow(), job.runNow()]);
      expect([a, b].filter((r) => r !== null)).toHaveLength(1); // a segunda foi ignorada
    } finally {
      job.stop();
      restore();
    }
    const text = lines.join('\n');
    expect(text).toContain('retention: concluído');
    expect(text).toContain('"guestsDeleted":1');
    expect(text).not.toContain('ApelidoSecreto');
    expect(text).not.toContain(g.id);
  });

  it('falha de SQL vira log com o nome do erro e o job segue vivo (runNow devolve null)', async () => {
    const lines: string[] = [];
    const restore = setLogSink((level, msg, f) => lines.push(JSON.stringify({ level, msg, ...f })));
    const broken = {
      $executeRaw: () => Promise.reject(new Error('senha=postgres://u:p@h/db')),
    } as unknown as PrismaHandle['prisma'];
    const job = startRetentionJob(broken, { firstDelayMs: 3_600_000, intervalMs: 3_600_000 });
    try {
      expect(await job.runNow()).toBeNull();
    } finally {
      job.stop();
      restore();
    }
    const text = lines.join('\n');
    expect(text).toContain('retention: falhou');
    expect(text).not.toContain('senha');
  });
});
