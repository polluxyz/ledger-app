# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-13，3g spec 已核可；plan 與 todo 待核可）

### 現況

- 3f 已合併（#113）並部署到 dev（`ledger_dev` 已 migrate；備份 `D:\Projects\ledger-app-backups\ledger_dev_before_3f_20261007_1056.dump`）。
- 3g（借還頁改版）先做原型給開發者操作，2026-10-13 開發者說原型告一段落。原型與文件都在分支 **`polluxyz/debts-inline`**（worktree `C:/Users/Administrator/orca/workspaces/ledger-app/debts-inline`，資料庫 `ledger_debts_inline_test`），已 push 到 origin 備份，**還沒開 PR**（PR 用整合分支 `feature/debts-inline` 開，見 plan §0）。這條分支以 `main`（`c801558`）為基底，與 `origin/main` 合併沒有衝突。
  - `docs/specs/phase-3g-debts-inline.md`：**已核可**（2026-10-13）。含 schema 變更（`DebtEntry.settlesEntryId`）與 API 變更（spec §3、§4），核可即視為同意；套 migration 前仍要把實際 SQL 列給開發者看。
  - `tasks/phase-3g-plan.md`、`tasks/phase-3g-todo.md`：**待核可**。
  - `tasks/archive/phase-3g-prototype-notes.md`：原型期間的決定紀錄，已全部併入 spec，PR 時移到 `tasks/archive/`。
- 開發者的 dev 伺服器在 `web-redesign` worktree，目前 **detached 在原型的 `a23de23`**（不是 `main`）。後端跟 3f 的 `main` 相同，原型只改了前端。
- Orca Run `run_78a4a8ab6c17`：原型的 worker 都已結束，沒有進行中的任務。紀錄裡的 `coordinator_handle` 是更早的 session，新 session 用 `run-use` 重新綁定。
- `ledger-split-web` worktree 是協調者寫文件用的（本次交接的 PR 在這裡開），它的 `apps/api/.env(.test)` 指向已刪除的 `ledger_uf_int_test`，要跑 API 前先改。
- 額度（2026-10-12 晚上）：Codex 週用量 46%；Pi GLM 的**週額度**用完，`fallback-1` 可能還沒恢復，派工前先 `orca account list`，不行就直接用 `fallback-2`（Antigravity）。

### 下一步

1. 請開發者核可 `tasks/phase-3g-plan.md` 與 `tasks/phase-3g-todo.md`。
2. 核可後照 todo 做到合併：G0 開 `feature/debts-inline`、契約、隔離測試（紅燈）→ 第 1 波 5 個 worker → 第 2 波 e2e → PR → CI → 合併。
3. 合併後問開發者要不要部署到 dev（先 `pg_dump` 備份）；照 memory「做完的分支要關」清 worktree、分支、終端機、測試資料庫（刪除清單先給開發者看，保留 `ledger_dev`、`ledger_test`）。
4. 還沒回覆的舊問題：改 Vite 設定讓 `packages/shared` 變更後預先打包快取自動失效；要不要加 App 的錯誤邊界（error boundary，畫面出錯時顯示錯誤頁而不是黑畫面）。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。
- **介面文字極簡，能用符號就不用文字**，同一種意思全站用同一種表示法（「使用者習慣後就都會很便利」）。
- 版面先做出來給他操作再調整，不急著開 PR（2026-10-07 起的 3g 原型）。他會逐點改細節。
- 要保留轉圜的餘地：已還清的紀錄也能修改、撤銷。
- 「以此結清」的差額照實際收付：帳戶只記實際收到的錢，差額不產生交易，留到統計時計入；多收、少收都允許（2026-10-13 確認）。
- 動畫只看站內的 `--motion-*` token，不看作業系統的 `prefers-reduced-motion`。
- 前端改動切到 dev 後，提醒他按 `Ctrl + Shift + R`（曾因 Vite 舊快取出現黑畫面）。
- **多用 worker**；做完的 worker 驗收後立刻清 worktree、分支、終端機。
- worker 用哪個模型，以 `docs/orca-multi-agent.md` §0 的角色表為準。Antigravity 回報「全綠」一律自己重跑確認。

### 替開發者部署

開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD）跑，API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. `git checkout --detach origin/main`。
  2. `pnpm --filter @ledger/shared build`，並刪掉 `apps/web/node_modules/.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，已離開花蓮三日）。
