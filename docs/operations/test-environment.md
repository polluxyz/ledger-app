# 測試環境

需要跑資料庫測試、使用 Prisma 資料庫指令或安排平行驗收時讀本頁。

- 單元測試跑 `pnpm test`。Web 本機平行度太高而逾時可跑 `pnpm --filter @ledger/web exec vitest run --maxWorkers=2`。
- API 用 `pnpm --filter @ledger/api test:e2e`。Web 第一次先跑 `pnpm --filter @ledger/web exec playwright install chromium`，再跑 `pnpm --filter @ledger/web test:e2e`。Web 自行啟動 API 3100 與 Web 5273。兩套均使用 `apps/api/.env.test` 並套用測試 migration。
- 兩套預設使用 `ledger_test`。測試會清空資料。共用同一資料庫時一次只能跑一套。API 若用獨立資料庫可平行。Web 固定連接埠，一次只跑一組。
- `.worktreeinclude` 會複製環境檔。複製來的 `apps/api/.env` 可能指向開發者的 `ledger_dev`。派工前由協調者把會碰 Prisma 的 worktree 中兩份環境檔都指向專屬的 `ledger_<名稱>_test`。worker 跑 `migrate` 或 `db` 前，確認實際連線為 `.env.test` 指定的測試資料庫。Web 只允許清空名稱以 `_test` 結尾的資料庫。
- 測試使用合成資料。測試帳號與密碼放在本機的 `docs/handoff/.env.test-accounts`，禁止提交。端對端測試依 [API 憑證規則](../../apps/api/CLAUDE.md#測試)取得登入憑證。

| 工作區       | 測試資料庫           |
| ------------ | -------------------- |
| main         | `ledger_test`        |
| ai-4a        | `ledger_ai_test`     |
| review-specs | `ledger_review_test` |

3c 與 3e 曾因環境檔誤指 dev，導致 migration 在合併前套到 dev。派工與驗收時均須確認實際目標。
