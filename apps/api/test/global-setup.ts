import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * 在整個 e2e 測試套件開始前執行一次。載入 .env.test，並對測試資料庫套用
 * migration，讓它的 schema 與目前的 Prisma schema 一致。
 */
export default function globalSetup(): void {
  config({ path: resolve(__dirname, '../.env.test') });
  execSync('npx prisma migrate deploy', {
    cwd: resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
}
