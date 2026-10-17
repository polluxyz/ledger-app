# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-18，3j 已合併並部署；等開發者操作回饋）

### 現況

- 3j（帳本刪除、封存、取消封存）已合併（spec #130、實作 #131 squash `052a80d`、修訂 #132 `1b9d5fb`）。spec `docs/specs/phase-3j-ledger-delete-archive.md`，驗證數字與偏離記在 `tasks/phase-3j-plan.md` §6。
  - 借還紀錄的每一種寫入都檢查帳本寫入權（決策 183，補上 3i 的缺口）。
  - 取消封存、封存不用打名稱；刪除前先看帳戶與往來的影響；私人帳本有借還也能刪（借還照撤銷處理）。
  - **決策 187（記到別人帳戶的交易擋刪除）是暫時的**：將來退出規則若定案為「退出後餘額不算」，一定要放寬（spec §1「延後」）。
- 已部署到 dev（2026-10-17）：有 1 個 migration（放寬 CHECK），備份 `D:Projectsledger-app-backupsledger_dev_before_3j_20261017_2256.dump`。`web-redesign` detached 在 `1b9d5fb`。**要請開發者重開 API、按 `Ctrl + Shift + R`。**
- 3j 的 worktree、分支、測試資料庫都已清掉，資料庫只剩 `ledger_dev`、`ledger_test`。Orca Run `run_2f928c8df06c` 沒有進行中的派工。
- `ledger-split-web` worktree 是協調者寫文件用的，它的 `apps/api/.env` 與 `.env.test` 指向 `ledger_test`。
- a@a.com 的測試情境見 3h spec §1（房東、阿德、明哥、花蓮三日）。
- 模型：`backend` 用 `gpt-6.1-sol` high，`default` 用 `gpt-6-luna` max（`docs/orca-multi-agent.md` §0）。Codex 啟動時可能卡在「有新版本」提示，選 3 後重派。

### 下一步

1. 等開發者操作 3j 後的回饋，依回饋開修訂（先改 spec 再改程式）。
2. 延後的退出規則（退出前看影響、撤銷並退出、共享帳本只剩自己可刪、複製到別的帳本）等複製功能時，跟 3f 決策 151、152 一起重想，並放寬決策 187。
3. 3i 已知限制還沒做：借還頁的往來紀錄列沒顯示名稱與分類；共享帳本其他成員看別人的借出有分類時，第一行是分類名稱。

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
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，已離開花蓮三日）。
- 要建測試資料時，開發者的 3000 若沒在跑，就暫時用 `PORT=3200 node dist/main` 起一個，用完關掉。登入端點有限流，同一個帳號只登入一次。
- 用 `psql` 查含中文的資料：把 SQL 寫成 UTF-8 檔、加 `PGCLIENTENCODING=UTF8` 再用 `-f` 跑，直接在指令列打中文會遇到編碼錯誤。
