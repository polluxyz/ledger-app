import { execSync } from 'node:child_process';
import { API_DIR, loadTestEnv } from './env';

/**
 * 整套 e2e 開跑前執行一次：載入測試環境變數，並把測試資料庫的 schema 帶到最新。
 *
 * 做法對齊 `apps/api/test/global-setup.ts`——兩套 e2e 用同一個 `ledger_test`
 * 資料庫，schema 的來源當然也該是同一份 migration。
 *
 * ⚠️ 正因為共用同一個資料庫，**本機不要同時跑這兩套 e2e**，會互相把資料清掉。
 */
export default function globalSetup(): void {
  loadTestEnv();

  execSync('npx prisma migrate deploy', {
    cwd: API_DIR,
    stdio: 'inherit',
    env: process.env,
  });
}
