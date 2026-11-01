import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

export interface PrismaHandle {
  readonly prisma: PrismaClient;
  /** Fecha o pool de conexões. Chame no SIGTERM, depois de parar de aceitar requisições. */
  close(): Promise<void>;
}

/**
 * Prisma 7 exige driver adapter: o `PrismaPg` cria e é dono do `pg.Pool`, que o `$disconnect`
 * encerra. A URL vem do ambiente (`DATABASE_URL`), nunca de arquivo versionado.
 */
export function createPrisma(
  databaseUrl: string,
  options?: { readonly maxConnections?: number },
): PrismaHandle {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: options?.maxConnections ?? 10,
  });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    close: () => prisma.$disconnect(),
  };
}
