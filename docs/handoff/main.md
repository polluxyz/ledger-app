# 交接：主工作區（main）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-11-12，以已合併紀錄為準）

- 角色：管理。handoff 入口、部署 dev、跨分支協調、從 Pollux 移植節省 token 的做法（`tasks/token-saving-plan.md`）。
- 3l（#140）、2j 統計（#154）與 4a AI 文字記帳（#155）已合併。
- 2k～2m 首頁改版已合併。2j 工作區的收尾見 [`stats-2j`](stats-2j.md)。
- 桌機 Chrome 語音輸入已合併（#209、#212），真實驗收尚未完成。詳見 `tasks/ai-voice-todo.md`。
- 專案審查報告已合併（#217），各項處理另開工作區進行。

## 下一步

- 節省 token：L1～L4 已完成，L2、L3 的實測都通過。剩 L5 的 7 天觀察，見 `tasks/token-saving-plan.md` §4、§5。
- 完成語音真實驗收與收尾，見 `tasks/ai-voice-plan.md` §1.4～1.5。
- 各項審查修正合併後，依下方步驟部署到 dev。

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
