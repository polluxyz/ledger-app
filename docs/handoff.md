# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-09-25，3b-2 畫面）

### 現況

- 3b-2 **全部完成**：後端 #73、畫面 spec #75（`docs/specs/phase-3b2-web.md`，W22～W43）、API 補充 F25、F26 #76、畫面 PR（見 git log）。實作紀錄：`tasks/archive/phase-3b2-web-plan.md` §6。
- 畫面：選人的下拉選單（只顯示名字與「連動」）、借還檢視「＋ 新增」、往來帳的邀請連動／取消邀請／解除連動／同步標籤／已同步紀錄的說明、總覽的「待確認」卡片（一次展開一筆）、邀請頁 `/invite#<token>`。
- 開發者決定**不顯示對方帳上的餘額**（W27）；API 的 `theirBalance` 保留。

### 下一步

1. 開發者操作 3b-2 畫面後給回饋，照 `CLAUDE.md` §5 先改 spec 再動工。
2. 可能的回饋點：待確認卡片不會自己刷新（要切回分頁或重新整理，plan §6 第 8 點）。
3. 更後面：代墊／多人分帳（「對方幫我付」併進去），需要改資料模型。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；設計涉及金錢時「不能繁瑣，但不能失去嚴謹」。
- 看到成果再調整：開發者習慣先操作畫面再回饋，spec 視為活文件。
- 單邊紀錄是「自己的紀錄」，刪改看自己；牽涉到對方（連動）才需要警告或確認。
- 不要先做半套：付款人欄位這類會一起調整的東西，等整體設計時一次做。
- 畫面**不出現「好友」**：有帳號的人與只存名字的人放同一份清單、不分頁，連動的人標「連動」（決策 51）。
- 解除連動後，對象的名字不能消失（決策 71）。
- worker 順序：Codex（`gpt-6-luna` max）→ Pi GLM → Antigravity Gemini；不必再問（`CLAUDE.md` §11）。
- 開發者的 dev API 用 `node dist/main` 跑、不是 watch：後端改完要提醒他 `pnpm build` 後重開 API；改了 `packages/shared` 也要重開 Vite。

### 已知問題與踩過的坑

- **dev 資料庫要套 3b-2 的 migration**（`20260925120000_link_counterparties`）：在 `apps/api` 跑 `pnpm exec prisma migrate deploy`、`pnpm build`，重開 API（`node dist/main`）與 Vite。
- Codex 有新版時會停在更新提示，`worker-start` 回 `agent-update-prompt`：選 3「Skip until next version」後關掉終端機重開。
- `prisma migrate dev` 在 agent 的非互動環境不能跑：用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL（plan §6 第 2 點）。
- dev 資料有一筆舊規則留下的「我還對方 +$1」（對方欠我時記的），不會自動修正，開發者可自行刪除。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**：預設編碼會把 UTF-8 中文變亂碼（本 session 踩過，已從 git 還原）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時仍會只貼上不送出，派工後要讀畫面、補 `orca terminal send --enter`（`docs/orca-multi-agent.md` §4 已記）。
