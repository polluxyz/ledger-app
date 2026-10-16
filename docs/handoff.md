# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-16，3i 已合併並部署；等開發者操作回饋）

### 現況

- 3i（借還紀錄可改名稱、帳戶、分類）已合併（spec #127、實作 #128，squash `0846188`）。spec `docs/specs/phase-3i-debt-entry-edit.md`，驗證數字與偏離記在 `tasks/phase-3i-plan.md` §6。
  - 記借還、免除剩餘、接受連動都不再選帳本，記在目前選的帳本（決策 182）。
  - 交易明細的還款分支收進 › 展開的細項（欠款、少收兩行，W181）。
- 已部署到 dev（2026-10-16）：沒有 migration，`web-redesign` worktree detached 在 `0846188`，shared 與 API 已 build。部署後用暫時的 3200 埠把 a@a.com 房東那筆換到 test1 再換回現金，兩個帳戶餘額都回到原值。**要請開發者重開 API 與 Vite、按 `Ctrl + Shift + R`。**
- 3i 的 worktree、分支、測試資料庫都已清掉，資料庫只剩 `ledger_dev`、`ledger_test`。Orca Run `run_3c25c6818af9` 沒有進行中的任務。
- `ledger-split-web` worktree 是協調者寫文件用的，它的 `apps/api/.env` 與 `.env.test` 指向 `ledger_test`。
- 3h 部署紀錄（2026-10-15）：備份 `D:\Projects\ledger-app-backups\ledger_dev_before_3h_20261015_0852.dump`，細節見 `tasks/phase-3h-plan.md` §6。
- a@a.com 的測試情境（3h spec §1，現金、`test 的帳本`）：
  - 房東：3/2 借出 93、3/6 還 90 以此結清 → 分支少收 3。
  - 阿德：3/3 借出 100、3/7 還 105 以此結清 → 分支多收 5。
  - 明哥：3/10 借出 500、免除 → 呆帳 500。
  - 花蓮三日：小華（c@c.com）替我記的晚餐 600 → 我的臨時帳戶 −600。
- 模型：`backend` 角色 2026-10-14 起用 `gpt-6.1-sol` high（#122），`default` 照舊 `gpt-6-luna` max。手動測 Codex 要把 `CODEX_HOME` 指向 Orca 的帳號目錄（`docs/orca-multi-agent.md` §5）。

### 下一步

1. 等開發者操作 3i 後的回饋，依回饋開修訂（先改 spec 再改程式）。
2. **待開發者決定**：往來紀錄只改金額、日期、備註，或撤銷時，不檢查帳本寫入權（被降為檢視者或帳本封存後仍能改）。3i 只替新欄位加了檢查（`tasks/phase-3i-plan.md` §6）。
3. 借還頁的往來紀錄列還沒顯示名稱與分類（3i 範圍外）；共享帳本的其他成員看別人的借出有分類時，第一行會是分類名稱（看不到對象，W179 只對自己的紀錄生效）。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。
- **介面文字極簡，能用符號就不用文字**，同一種意思全站用同一種表示法（「使用者習慣後就都會很便利」）。
- 版面先做出來給他操作再調整，不急著開 PR（2026-10-07 起的 3g 原型）。他會逐點改細節。
- 要保留轉圜的餘地：已還清的紀錄也能修改、撤銷。
- 「以此結清」照實際收付：帳戶只記實際收到的錢，差額是還款底下同帳戶的分支交易（3h）；多收、少收都允許。
- 編輯要有意義：借還能直接改名稱、帳戶、分類，不要逼使用者撤銷重記（2026-10-15）。
- 介面設計先給預覽頁看（`docs/artifacts/`），他會直接指出要改的樣式。
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
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
