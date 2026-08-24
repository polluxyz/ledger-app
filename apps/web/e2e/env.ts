import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * e2e 測試的環境設定：埠號、位址，以及測試用環境變數的載入。
 *
 * 單獨一個檔案的理由是它有兩個消費者——`playwright.config.ts`（要在啟動伺服器前
 * 就拿到值）與測試本身。放在設定檔裡的話，測試就得從設定檔匯入，方向會反過來。
 */

/**
 * 測試專用埠，不是平常的 3000 / 5173（D6）。
 *
 * 開發者手邊很可能正開著自己的 dev server。共用埠號的下場是測試莫名其妙連到一個
 * 被手動改過的環境，或者根本搶不到埠。
 */
export const API_PORT = 3100;
export const WEB_PORT = 5273;

export const API_ORIGIN = `http://localhost:${API_PORT}`;
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** 後端所有路由都掛在 `/api` 之下（見 `apps/api/src/main.ts` 的 setGlobalPrefix）。 */
export const API_BASE_URL = `${API_ORIGIN}/api`;

/**
 * 伺服器就緒的判定位址（P1）。
 *
 * 為什麼不是根路徑：`/` 會回 404，因為路由全部在 `/api` 之下。
 * 為什麼不是某個 API 端點：沒帶 token 會回 401，靠「401 也算活著」這種行為吃飯太脆。
 * `/docs` 是 Swagger UI，本來就存在，回 200。
 *
 * ⚠️ 哪天決定不對外曝露 API 文件，這裡要跟著改。
 */
export const API_READY_URL = `${API_ORIGIN}/docs`;

const HERE = dirname(fileURLToPath(import.meta.url));

/** `apps/api` 的絕對路徑——migration 與 `.env.test` 都在那裡。 */
export const API_DIR = resolve(HERE, '../../api');

/**
 * 載入 `apps/api/.env.test`（本機用；該檔已被 git ignore）。
 *
 * 檔案不存在時**不報錯**：CI 沒有這個檔案，那裡的 `DATABASE_URL` 與 `JWT_SECRET`
 * 由 workflow 直接注入。做法與 `apps/api/test/global-setup.ts` 一致，
 * 差別只在這裡用 Node 內建的 `process.loadEnvFile`，不必多裝一個 dotenv。
 */
export function loadTestEnv(): void {
  const envTestPath = resolve(API_DIR, '.env.test');
  if (existsSync(envTestPath)) {
    process.loadEnvFile(envTestPath);
  }
}

/** 取一個必要的環境變數；缺了就當場說清楚缺哪一個，而不是讓後面出現莫名其妙的錯誤。 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `e2e 需要環境變數 ${name}。本機請在 apps/api/.env.test 設定，CI 由 workflow 注入。`,
    );
  }
  return value;
}
