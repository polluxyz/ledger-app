# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-09-25，3b-2 後端）

### 現況

- 3b-2 連動 spec 已核可並合併（#72）：`docs/specs/phase-3b2-linking.md`（決策 51～72、SC-K1～K18）。
- 3b-2 **後端**在 `feature/phase-3b2-linking-api`（PR 見 git log）：連動邀請（email、連結）、接受、解除、提議（新增、改、刪、免除）、`link.theirBalance`、`sync`、`paired`、`POST /counterparties`、`?q=`。實作紀錄：`tasks/phase-3b2-linking-plan.md` §6。
- Web 只做了讓型別通過的最小調整，沒有新畫面。

### 下一步

1. 寫 `docs/specs/phase-3b2-web.md`（畫面 spec）並產樣稿，送開發者審。方向見 3b-2 spec §7：下拉選單（一份清單、標「連動」）、往來帳的邀請／解除／對方餘額／同步狀態、總覽的「待確認」卡片、`/invite#<token>` 接受頁。
2. 畫面核可後派 worker 實作（Codex 優先）。
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

- **dev 資料庫還沒套 3b-2 的 migration**（`20260925120000_link_counterparties`）。合併後跑 `prisma migrate deploy`、`pnpm build`、重開 API 與 Vite。
- `prisma migrate dev` 在 agent 的非互動環境不能跑：用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL（plan §6 第 2 點）。
- dev 資料有一筆舊規則留下的「我還對方 +$1」（對方欠我時記的），不會自動修正，開發者可自行刪除。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**：預設編碼會把 UTF-8 中文變亂碼（本 session 踩過，已從 git 還原）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時仍會只貼上不送出，派工後要讀畫面、補 `orca terminal send --enter`（`docs/orca-multi-agent.md` §4 已記）。
