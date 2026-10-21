# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-21，2j 統計與 4a AI 兩條分支平行開工）

### 分工

開發者 2026-10-21 決定：2j 統計與 4a AI 文字記帳**各開一條分支、各由一個 session 負責**，開發者分別到各分支對話；需要管理時才回 main。

| 分支                     | worktree   | 測試資料庫          | spec                             | 狀態                                |
| ------------------------ | ---------- | ------------------- | -------------------------------- | ----------------------------------- |
| `feature/phase-2j-stats` | `stats-2j` | `ledger_stats_test` | `docs/specs/phase-2j-stats.md`   | 核可中：§10 的 10 項要跟開發者確認  |
| `feature/phase-4a-ai`    | `ai-4a`    | `ledger_ai_test`    | `docs/specs/phase-4a-ai-text.md` | 已核可（「AI 先這樣試試」）         |
| `main`                   | 主工作區   | —                   | —                                | 管理：handoff、部署 dev、跨分支協調 |

- 兩條分支的 spec 只在各自的分支上，還沒進 main。各分支照 CLAUDE.md §5 寫 plan、todo，送開發者核可，再派工、開 PR、合併。
- 預覽頁（不進版控）：`docs/artifacts/step-2j-stats-preview.html`（v2，首頁加資產趨勢圖）、`docs/artifacts/step-4a-ai-draft-preview.html`。
- 分期與口徑的研究：advisor（Codex gpt-6-astra high，開發者指定）的報告結論已寫進 2j spec。

### 平行時的規則

- **編號分段，避免撞號**：2j 已用決策 227～236、254～257、W201～W207、W215～W216，之後用 260～279、W220～W239；4a 已用 237～253、W208～W214，之後用 280～299、W240～W259。成功條件 2j 用 `SC-R`、4a 用 `SC-P`。
- **兩邊都會改的檔案**：`apps/api/src/app.module.ts`（註冊模組）、`packages/shared/src/index.ts`（匯出）、側欄、`docs/README.md`、`CLAUDE.md` §4。每處只多幾行；後合併的一方用 `gh pr update-branch` 併進 main 再解。
- **Web e2e 一次只能一個 worktree 跑**（固定埠 3100／5273）。跑之前先看埠有沒有被占。API e2e 各用各的資料庫，可以同時跑。
- **Codex 週額度兩邊共用**（10-21 晚上約 72%，週三 09:43 重置）。網頁實作只交給 Codex，用完就停下來問開發者。
- **部署到 dev** 都在 main 主工作區做（開發者的 dev 伺服器從這裡跑）。哪條先合併就先部署那條，另一條合併後再部署一次。

### 各分支的下一步

- **2j**：跟開發者確認 spec §10（API、歸屬規則、固定分組、明細、期間上限、效能量法、資產定義、初始餘額、資產 API）→ 寫 `tasks/phase-2j-plan.md`、`-todo.md` → 核可 → docs PR → 實作。
- **4a**：寫 `tasks/phase-4a-plan.md`、`-todo.md` → 核可 → docs PR → 實作，先用假 provider。開發者確認 GLM 方案能給 App 使用後提供金鑰，金鑰只放 `apps/api/.env`；接上後跑 SC-P10。費用控管之後再設。

### 其他現況

- 3l 已合併並部署（#140，`d29d454`）；之後 #142 修了搬移對話框的橫向捲動。開發者沒有再回報 3l 的問題。
- worktree：`backend`（DB `ledger_backend_test`）、`ledger-split-web`（main 寫文件用）、`web-redesign`（停在 `912e0d9`，沒在用）。
- 分工照舊：網頁實作只交給 Codex；Claude Code 規劃、派工、驗收。各 session 不互傳訊息，讀分支掌握進度。

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
