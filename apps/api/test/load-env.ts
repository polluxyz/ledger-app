import { config } from 'dotenv';
import { resolve } from 'node:path';

// 在每個 jest worker 啟動 app 之前執行。載入 .env.test，讓 app 連到 ledger_test。
// dotenv 不會覆蓋「已存在」的環境變數，因此在 CI（DATABASE_URL／JWT_SECRET 來自
// 環境）中這行等同無作用，CI 的值優先。
config({ path: resolve(__dirname, '../.env.test') });
