# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-19，3k 已合併並部署；等開發者操作回饋）

### 現況

- 3k（退出共享帳本並合併到別的帳本）已合併：#137（squash `912e0d9`）。spec `docs/specs/phase-3k-leave-and-merge.md`（決策 189～208），驗證數字與偏離記在 `tasks/phase-3k-plan.md` §6。
  - 實作時開發者另外核可：`DebtEntry.merge`（W192 顯示來源帳本名）、`LedgerMerge.targetLedgerId` 改 `SET NULL`（多一個 migration）、被加回時撤銷上次的帳本轉入（決策 208）、拿掉恆為 `false` 的 `left` 欄位與 `LEDGER_LEFT`。
- 已部署到 dev（2026-10-19）：備份 `D:\Projects\ledger-app-backups\ledger_dev_before_3k_20261019_2053.dump`，套用 `20261019000000_ledger_merge`、`20261019130000_ledger_merge_target_set_null`，`web-redesign` detached 在 `912e0d9`，shared 與 API 已 build。部署前查「已退出、帳戶還在算」為 0 筆。
- 部署後用暫時的 3200 埠照 plan §4 走過一次：a@a.com 建暫時共享帳本、加 b@b.com、記住宿／晚餐／結清；b 退出並合併後帳戶餘額不變、合併來的 3 列標來源帳本、借還頁不再出現、打開回 404；a 以最後一人全部不合併刪除，預覽與結果一致；最後刪掉 b 合併來的交易，兩人帳戶都回到原值。軟刪除的交易與 `LedgerMerge` 留在資料庫。
- **開發者 10-19 晚上在 main worktree（`D:\Projects\ledger-app`）開了 API 與 Vite**：main 的 shared `dist` 與 `src/generated/prisma` 是舊的，API 報 117 個型別錯；Vite 因 5173 被佔用跑到 5174。已請他停掉、改回 `web-redesign` 重開。
- 分工（2026-10-19 起）：main 的 session 是總控，`backend` worktree（detached，DB `ledger_backend_test`）做後端，前端 session 開在 `web-redesign`。3k 期間兩個 session 各有子分支，只有總控寫整合分支。兩個 session 都已停手待命。
- worktree：`backend`、`ledger-split-web`（協調者寫文件用，`.env` 指向 `ledger_test`）、`web-redesign`（開發者的 dev），都 detached 在 `912e0d9`。3k 的分支都已刪。
- **待開發者同意刪除的測試資料庫**：`ledger_lvm_{migrate,rules,leave,merged,web,webe2e}_test`。`ledger_backend_test` 是 backend worktree 長駐用的，保留。
- Codex 週額度用到約 99%（約 10-25 重置）。開發者 10-19 指示：Codex 用到 worker 真的報額度錯誤才換 `fallback-1`，不看 §4 的 95% 門檻（`docs/orca-multi-agent.md` §4 還沒改）。

### 下一步

1. 請開發者在 `web-redesign` 重開 API 與 Vite、按 `Ctrl + Shift + R`，操作 3k。
2. 請 d@d.com（花蓮三日）、a2@a.com（share）用新流程退出。
3. 刪除上面列的 6 個測試資料庫（等開發者同意）。
4. 依回饋開修訂（先改 spec 再改程式）。
5. 3k 之後是階段四 AI 文字記帳。開工前先問開發者：LLM provider、草稿欄位、費用上限；並決定前端、後端 session 怎麼分工。

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

開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD）跑，API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. `git checkout --detach origin/main`。
  2. `pnpm --filter @ledger/shared build`。Vite 會自己更新預先打包，不必刪 `.vite`。
  3. schema 有變：先 `pg_dump` 備份 `ledger_dev`，在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑），再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，花蓮三日）、a2@a.com（share）。
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
