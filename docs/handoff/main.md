# 交接：主工作區（main）

入口與跨工作區規則見 [`../handoff.md`](../handoff.md)。

## 現況（2026-10-22）

- 角色：管理。handoff 入口、部署 dev、跨分支協調、從 Pollux 移植節省 token 的做法（`tasks/token-saving-plan.md`）。
- 3l 已合併並部署（#140，`d29d454`）；之後 #142 修了搬移對話框的橫向捲動。開發者沒有再回報 3l 的問題。
- 10-22 清掉沒在用的 worktree `backend`、`web-redesign`。沒人用的測試資料庫 `ledger_backend_test` 經開發者同意刪除。`ledger-split-web` 的工作已在 #147 合併，worktree 與分支都已不在。
- 10-22 把 main（#144～#148）併進 2j、4a 兩條分支並推上去。

## 下一步

- 節省 token：L1～L4 已完成，L2、L3 的實測都通過。剩 L5 的 7 天觀察，見 `tasks/token-saving-plan.md` §4、§5。
- 2j、4a 合併後部署到 dev。

## 替開發者部署

開發者的 dev 伺服器在主工作區（`D:\Projects\ledger-app`）跑（2026-10-21 確認），API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. 主工作區跑 `git pull`（它在 `main` 分支上，不是 detached）。
  2. `pnpm --filter @ledger/shared build`。Vite 會自己更新預先打包，不必刪 `.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，花蓮三日）、a2@a.com（share）。
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
