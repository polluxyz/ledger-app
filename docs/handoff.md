# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-14，3g 已合併並部署；等開發者操作回饋）

### 現況

- 3g（借還頁列內展開與四個子分頁）已合併（#115，squash `69a9077`）。驗證數字與 plan 的偏離記在 `tasks/phase-3g-plan.md` §6。
- 已部署到 dev：備份 `D:\Projects\ledger-app-backups\ledger_dev_before_3g_20261013_2042.dump`，migration `20261013110026_debt_entry_settles_entry` 已套用。`web-redesign` worktree detached 在 `69a9077`，API 已 build。
- 3g 的 worktree、分支、測試資料庫都已清掉，資料庫只剩 `ledger_dev`、`ledger_test`。Orca Run `run_78a4a8ab6c17` 沒有進行中的任務；新 session 用 `run-use` 重新綁定。
- a@a.com 另有 3 個測試用對象。往來紀錄都是「不記入帳本」，所以不屬於任何帳本，也不動帳戶：
  - 明哥：借出、還款、再借出，餘額 500。
  - 房東：借出 93、還 90 以此結清（綁定的差額），餘額 0。測歷史的修改與撤銷。
  - 阿德：每天借出 10，共 25 筆，餘額 250。測「載入更多」。
- `ledger-split-web` worktree 是協調者寫文件用的，它的 `apps/api/.env(.test)` 指向已刪除的資料庫，要跑 API 前先改。
- 額度（2026-10-13）：Codex 方案已停（`gpt-6-sol` 回「not supported when using Codex with a ChatGPT account」），開發者重新購買前不派 Codex。先用 GLM，用完改 Claude Haiku 5.5 xhigh。

### 下一步

1. 等開發者操作 3g 後的回饋，依回饋開修訂（先改 spec 再改程式）。
2. 加 App 的錯誤邊界（error boundary，畫面出錯時顯示錯誤頁而不是黑畫面），開發者 2026-10-14 同意。

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
  2. `pnpm --filter @ledger/shared build`。Vite 會自己更新預先打包，不必刪 `.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，已離開花蓮三日）。
