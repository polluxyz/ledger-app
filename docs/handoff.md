# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-09-26，3b-2 修訂 1）

### 現況

- 3b-2 修訂 1 完成（PR 見 git log）：側欄「對象」頁、邀請不綁人、接受後詢問「之前有沒有用別的名字記過他」並合併、暱稱（`displayName`）、介面文字極簡。spec：`phase-3b2-linking.md` §12（決策 73～81）、`phase-3b2-web.md` §10（W44～W51）。實作紀錄：`tasks/archive/phase-3b2-revision1-plan.md` §5。
- 交易頁的「借還」檢視維持原樣（看帳）；「對象」頁管人，不顯示欠款。
- 派工規則更新：複雜後端派 Codex `gpt-6-sol` xhigh（`CLAUDE.md` §11）。

### 下一步

1. 開發者操作修訂 1 的畫面後給回饋；照 `CLAUDE.md` §5 先改 spec 再動工。
2. 仍未處理：待確認卡片不會自己刷新（要切回分頁或重新整理）。
3. 更後面：代墊／多人分帳（要改資料模型）。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；設計涉及金錢時「不能繁瑣，但不能失去嚴謹」。
- 看到成果再調整：開發者習慣先操作畫面再回饋，spec 視為活文件。
- 單邊紀錄是「自己的紀錄」，刪改看自己；牽涉到對方（連動）才需要警告或確認。
- 不要先做半套：付款人欄位這類會一起調整的東西，等整體設計時一次做。
- 畫面**不出現「好友」**；管人的頁面叫「對象」，分「已連動」「未連動」兩區（修訂 1）。
- **介面文字極簡**：彈窗只放標題、欄位、按鈕；只有和錢有關、不寫會做錯時留一句短話（W44）。
- 解除連動後，對象的名字不能消失（決策 71）。
- worker 順序：Codex（`gpt-6-luna` max）→ Pi GLM → Antigravity Gemini；不必再問（`CLAUDE.md` §11）。
- 開發者的 dev API 用 `node dist/main` 跑、不是 watch：後端改完要提醒他 `pnpm build` 後重開 API；改了 `packages/shared` 也要重開 Vite。

### 已知問題與踩過的坑

- **dev 資料庫要套新的 migration**（`20260926120000_counterparty_nickname_merge`）：在 `apps/api` 跑 `pnpm exec prisma migrate deploy`、`pnpm build`，重開 API（`node dist/main`）與 Vite。這個 migration 會取消所有還沒被接受的舊邀請。
- Codex 有新版時會停在更新提示，`worker-start` 回 `agent-update-prompt`：選 3「Skip until next version」後關掉終端機重開。
- `prisma migrate dev` 在 agent 的非互動環境不能跑：用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL（plan §6 第 2 點）。
- dev 資料有一筆舊規則留下的「我還對方 +$1」（對方欠我時記的），不會自動修正，開發者可自行刪除。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**：預設編碼會把 UTF-8 中文變亂碼（本 session 踩過，已從 git 還原）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時仍會只貼上不送出，派工後要讀畫面、補 `orca terminal send --enter`（`docs/orca-multi-agent.md` §4 已記）。
