// Prisma 7 no longer auto-loads .env — load it explicitly for CLI commands.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Used by the Prisma CLI (migrate/studio); the runtime client gets its
    // connection via the pg driver adapter instead.
    url: process.env.DATABASE_URL ?? '',
  },
});
