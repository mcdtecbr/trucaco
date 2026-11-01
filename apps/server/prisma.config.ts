import { defineConfig } from 'prisma/config';

// Prisma 7: a URL do banco sai do schema e vem daqui. `prisma generate` não conecta,
// então a variável é opcional nesse comando; migrate/deploy exigem DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] ?? '' },
});
