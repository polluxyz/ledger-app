# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-21，3l 已合併並部署；等開發者操作回饋）

### 現況

- 3l（刪除私人帳本時分組搬走交易、複製交易、標註交易）已合併：#140（squash `d29d454`）。spec `docs/specs/phase-3l-move-and-copy.md`（決策 209～226、W194～W200），驗證數字、偏離與驗收退回記在 `tasks/phase-3l-plan.md` §6。
  - 實作時開發者另外決定：搬進共享帳本的個人借還照 3b 決策 13（別人看得到交易、看不到往來）；帳本頁按鈕寫「刪除帳本」；刪除後數字依增減上色，3k 退出對話框一起改。
  - 後端 L3 自訂的規則 C：列表不單獨顯示的交易被標註時，存到列表上看得到的代表列（結清分支→還款、個人分帳→擁有者的合成列、合併來的→份額）。已向開發者報告。
- 已部署到 dev（2026-10-21）：備份 `D:Projectsledger-app-backupsledger_dev_before_3l_20261021_1247.dump`，套用 `20261021000000_transaction_mark`，main worktree 已 pull 到 `d29d454`、shared 與 API 已 build。用暫時的 3200 埠照 plan §4 走過一次，結果都符合，暫時資料已清。
- **開發者的 dev 伺服器現在從 main worktree（`D:Projectsledger-app`）跑**：API 是 `node dist/main`、Vite 在 `apps/web`。部署要做在 main，不是 `web-redesign`。
- 分工（2026-10-21 起）：**網頁實作只交給 Codex**，Claude Code 只做規劃、派工、驗收，驗收不過退回 Codex，不自己改網頁程式；Codex 用完就停下來問，不換層。**總控不跟其他 session 互傳訊息**，讀分支掌握進度；要決定的事開發者會親自到各 session 回答。後端仍照角色表。
- worktree：`backend`（DB `ledger_backend_test`）、`ledger-split-web`（總控寫文件用，`.env` 指向 `ledger_test`）都 detached 在 `main`；`web-redesign` 還停在 `912e0d9`，目前沒在用。3l 的本機分支都已刪。
- 3l 的測試資料庫 `ledger_ldm_*_test` 與遠端分支 `feature/ldm-api` 已經開發者同意刪除。剩 `ledger_dev`、`ledger_test`、`ledger_backend_test`（backend worktree 長駐，保留）。
- Codex 週額度 10-21 已重置，3l 用到約 8%。

### 下一步

1. 請開發者重開 API 與 Vite、按 `Ctrl + Shift + R`，操作 3l。
2. 依回饋開修訂（先改 spec 再改程式）。
3. 之後是階段四 AI 文字記帳。開工前先問開發者：LLM provider、草稿欄位、費用上限。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。
- **介面文字極簡，能用符號就不用文字**，同一種意思全站用同一種表示法（「使用者習慣後就都會很便利」）。
- 版面先做出來給他操作再調整，不急著開 PR（2026-10-07 起的 3g 原型）。他會逐點改細節。
- 要保留轉圜的餘地：已還清的紀錄也能修改、撤銷。
- 「以此結清」照實際收付：帳戶只記實際收到的錢，差額是還款底下同帳戶的分支交易（3h）；多收、少收都允許。
- 編輯要有意義：借還能直接改名稱、帳戶、分類，不要逼使用者撤銷重記（2026-10-15）。
- 預覽或影響清單只列會變的東西，「兩清 → 兩清」這種沒變化的不要顯示（2026-10-17）。
- 介面設計先給預覽頁看（`docs/artifacts/`），他會直接指出要改的樣式。
- 動畫只看站內的 `--motion-*` token，不看作業系統的 `prefers-reduced-motion`。
- 前端改動切到 dev 後，提醒他按 `Ctrl + Shift + R`（曾因 Vite 舊快取出現黑畫面）。
- **多用 worker**；做完的 worker 驗收後立刻清 worktree、分支、終端機。
- worker 用哪個模型，以 `docs/orca-multi-agent.md` §0 的角色表為準。Antigravity 回報「全綠」一律自己重跑確認。

### 替開發者部署

開發者的 dev 伺服器在 main worktree（`D:\Projects\ledger-app`）跑（2026-10-21 確認），API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. main worktree 跑 `git pull`（它在 `main` 分支上，不是 detached）。
  2. `pnpm --filter @ledger/shared build`。Vite 會自己更新預先打包，不必刪 `.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，花蓮三日）、a2@a.com（share）。
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
