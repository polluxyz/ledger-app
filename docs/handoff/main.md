# 主工作區交接

main 建立任務、指派工作區與 worker，協調共用資源並部署 dev。各線里程碑與待決事項見[交接入口](../handoff.md)。

## 現況與下一步

- R1 與 R6 已部署。Haiku 程式已合併；待 ai-4a 回報真實模型驗收結果，再切換 dev 使用的模型。
- 節省 token 計畫剩 L5 的 7 天觀察。[計畫 §4、§5](../../tasks/token-saving-plan.md)
- 審查小項 R9、R7、R8、R11、R13、R14、X1、X2、F5 待開發者決定優先順序，再由 main 指派。[審查報告](../reports/2026-11-11-project-review.md)
- 每週日 10:00（Asia/Taipei）由 Orca 在此工作區整理 ledger-app。盤點與關閉條件見[派工與交接](../orca-multi-agent.md)。

## 替開發者部署

開發者的 dev 伺服器在主工作區（`D:\Projects\ledger-app`）跑（2026-10-21 確認），API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. 主工作區跑 `git pull`（它在 `main` 分支上，不是 detached）。
  2. `pnpm --filter @ledger/shared build`。Vite 會自己更新預先打包，不必刪 `.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號與密碼放在本機檔案 `docs/handoff/.env.test-accounts`，不進版控。
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
