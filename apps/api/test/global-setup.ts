import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Runs once before the e2e suite. Loads .env.test and applies migrations to the
 * test database so its schema matches the current Prisma schema.
 */
export default function globalSetup(): void {
  config({ path: resolve(__dirname, '../.env.test') });
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
}
