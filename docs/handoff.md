# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-18，3k spec 已核可；plan 與 todo 待核可）

### 現況

- 3k（退出共享帳本並合併到別的帳本）的 spec 已核可：`docs/specs/phase-3k-leave-and-merge.md`，含 §10 的 5 條。plan `tasks/phase-3k-plan.md` 與 todo `tasks/phase-3k-todo.md` 已寫，**還沒核可**。三份跟本檔在同一個 docs PR。
- 預覽頁 `docs/artifacts/step-3k-leave-merge-preview.html`（在 `web-redesign` worktree，不進版控）已發布成 artifact `https://claude.ai/artifact/8uXoEdW3PWM1RcAc1QdDm2`（Version 4）。
- 討論時開發者的取捨（理由都寫進 spec 的決策與 W189）：
  - 退出＝從我這邊刪除；只有「合併」、沒有「保留」；沒勾的交易對帳戶的影響直接消失。
  - 我付的代墊整筆合併，別人付的只合併我的份額、沒有帳戶。欠款不逐筆標，只在「帳本轉入」的總數出現一次（3f 決策 142 整群抵銷）。選擇畫面上別人付的列寫「小華付」，不寫「不動帳戶」。
  - 「選擇交易」另開一個比較大的畫面；下方的帳戶段每勾一次就同步變化。
- 借還頁紀錄列加了分類圖示與名稱（#135，`92a3293`），已部署到 dev。3i 已知限制「往來紀錄列沒顯示名稱與分類」因此解掉了。
- dev 上 2 位舊規則下退出的成員已用擁有者身分透過 API 加回：d@d.com 回到花蓮三日、a2@a.com 回到 share，角色都是 EDITOR。3k 上線後要請他們用新流程退出。
- `web-redesign` detached 在 `92a3293`。資料庫只剩 `ledger_dev`、`ledger_test`。沒有進行中的 Orca Run 或 worker。
- worktree：`leave-merge-spec`（這個 docs PR 用，合併後可以清）、`ledger-split-web`（協調者寫文件用，`.env` 指向 `ledger_test`）、`web-redesign`（開發者的 dev）。
- a@a.com 的測試情境見 3h spec §1（房東、阿德、明哥、花蓮三日）。
- 模型：看 `docs/orca-multi-agent.md` §0。設計取捨多時可以先派 `advisor`（§1.1）。

### 下一步

1. 請開發者核可 3k plan 與 todo（docs PR 合併不等於 plan 核可，先問）。
2. 核可後照 plan §2：從 `main` 開整合分支 `feature/ledger-leave-merge`，協調者做 K0（shared 契約、隔離測試先紅），再派第 1 波 K1、K2、K5。
3. K7 部署前跑 spec §8 的查詢，備份 `ledger_dev` 再 `migrate deploy`。
4. 3k 完成後是階段四 AI 文字記帳。開工前先問開發者：LLM provider、草稿欄位、費用上限。

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
