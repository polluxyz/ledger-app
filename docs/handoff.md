# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-15，3h 已合併並部署；等開發者操作回饋）

### 現況

- 3h（每一筆帳都要對到帳戶）已合併（#123，squash `aa370ab`）。spec `docs/specs/phase-3h-every-entry-has-account.md`，驗證數字與 plan 的偏離記在 `tasks/phase-3h-plan.md` §6。
- 已部署到 dev（2026-10-15）：備份 `D:\Projects\ledger-app-backups\ledger_dev_before_3h_20261015_0852.dump`，migration `20261014150000_every_entry_has_account`、`20261014160000_forgiveness_has_transaction` 已套用。`web-redesign` worktree detached 在 `aa370ab`，API 已 build。
  - 部署前刪掉測試資料：對象明哥、房東、阿德（用 API）；帳本 `ttt`、`家用（不連動測試）`（API 刪不掉——一本已封存、一本有別人的交易——開發者同意後用 SQL 刪）。
  - 套用後比對：33 個一般帳戶餘額、往來餘額都不變；花蓮三日小明（b@b.com）付的 3 筆進了他的臨時帳戶（−1,850）；對象「t」的舊差額轉成分支（收回 101、少收 1）。
- a@a.com 的測試情境（spec §1，現金、`test 的帳本`）：
  - 房東：3/2 借出 93、3/6 還 90 以此結清 → 分支少收 3。
  - 阿德：3/3 借出 100、3/7 還 105 以此結清 → 分支多收 5。
  - 明哥：3/10 借出 500、免除 → 呆帳 500。
  - 花蓮三日：小華（c@c.com）替我記的晚餐 600 → 我的臨時帳戶 −600。
- 3h 的 worktree、分支、10 個測試資料庫都已清掉，資料庫只剩 `ledger_dev`、`ledger_test`。Orca Run `run_00e6b996bab7` 沒有進行中的任務。
- `ledger-split-web` worktree 是協調者寫文件用的，它的 `apps/api/.env(.test)` 指向已刪除的資料庫，要跑 API 前先改。
- 模型：`backend` 角色 2026-10-14 起用 `gpt-6.1-sol` high（#122），`default` 照舊 `gpt-6-luna` max。手動測 Codex 要把 `CODEX_HOME` 指向 Orca 的帳號目錄（`docs/orca-multi-agent.md` §5）。

### 下一步

1. 等開發者操作 3h 後的回饋，依回饋開修訂（先改 spec 再改程式）。
2. 已知小缺口（plan §6 第 15 項）：免除的帳本沒有「最近一次」時是空的，要使用者自己選；交易表單有補「第一個帳戶」，免除沒有比照。

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
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
