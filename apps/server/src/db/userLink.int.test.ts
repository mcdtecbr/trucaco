import { afterAll } from 'vitest';
import { createPrisma, type PrismaHandle } from './prisma';
import { PrismaMatchRepository, PrismaUserRepository } from './prismaRepositories';
import { assertSafeTestDatabaseUrl } from './testDatabase';
import { userLinkContract } from './userLinkContract';

/**
 * Vínculo de conta social contra Postgres real (`pnpm test:int`, bloco 6F): o UPDATE condicional e a
 * unicidade `(provider, provider_subject)` decidem as corridas. Banco DESCARTÁVEL já migrado.
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
  userLinkContract('Postgres', () => ({
    users: new PrismaUserRepository(prisma()),
    matches: new PrismaMatchRepository(prisma()),
    reset: async () => {
      await prisma().$executeRawUnsafe(
        'TRUNCATE TABLE progression_applied, user_stats, user_missions, user_achievements, reports, blocks, partner_codes, match_players, matches, avatars, users CASCADE',
      );
    },
  }));
}
