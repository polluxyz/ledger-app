# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-09-25）

### 現況

- 3b-1 往來帳版已合併（#67），之後依開發者操作回饋做了**修訂 1**（#69）：
  - 借還只剩 3 個種類：借出、借入、還款。API 收 `REPAYMENT`，後端依當下餘額存成 `COLLECT` 或 `REPAY`。
  - 沒勾「以此結清」又多還 → 409 `REPAYMENT_EXCEEDS_BALANCE`；餘額 0 → 409 `NOTHING_TO_REPAY`。
  - 修改、刪除既有紀錄一律不擋（決策 48）。
  - 寫入前鎖住對象（`SELECT … FOR UPDATE`，決策 50）。
  - 「對方幫我付」從畫面拿掉，後端保留，之後與代墊一起做（決策 49）。
  - 規格：`phase-3b-debts.md` §2.3、§3.2.1；`phase-3b1-web.md` §2.1。實作紀錄：`tasks/archive/phase-3b1-repayment-plan.md`。
- #70：`TextField` 預設 `autoComplete="off"`，修掉金額欄跳出 email 推薦。開發者還沒在 Chrome 手動確認。
- 沒有 schema 變更；dev 資料庫仍在 `20260924200000_replace_debts_with_ledger`。
- `main` 乾淨，沒有進行中的分支或 Orca worker（Run `run_c61ca80f6971` 的 worker 已 release、終端機已關）。

### 下一步

1. 開發者可能繼續操作往來帳並回饋。照 `CLAUDE.md` §5：先釐清、必要時先改 spec，再動工。
2. 依往來帳重新設計 **3b-2 連動**的 spec（方向見 `phase-3b-debts.md` §11）。這一輪要一起設計的延後項目（§9）：
   - **對象下拉選單**：分頁顯示「好友」與「自訂對象」，列出餘額、可篩選、可新增；能不記帳先建對象（需要 `POST /counterparties`）。取代目前的 `<datalist>`。
   - 改或刪**已連動**的紀錄前要警告；單邊紀錄維持自由刪改（決策 48）。
3. 更後面：**代墊／多人分帳**，放在支出表單，用「誰付的、誰分攤」表達，「對方幫我付」併進去。需要改資料模型（`DebtEntry.transactionId` 是唯一值，一筆交易對不到多人）。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；設計涉及金錢時「不能繁瑣，但不能失去嚴謹」。
- 看到成果再調整：開發者習慣先操作畫面再回饋，spec 視為活文件。
- 單邊紀錄是「自己的紀錄」，刪改看自己；牽涉到對方（連動）才需要警告或確認。
- 不要先做半套：付款人欄位、下拉選單分頁這類會一起調整的東西，等整體設計時一次做。
- worker 順序：Codex（`gpt-6-luna` max）→ Pi GLM → Antigravity Gemini；不必再問（`CLAUDE.md` §11）。
- 開發者的 dev API 用 `node dist/main` 跑、不是 watch：後端改完要提醒他 `pnpm build` 後重開 API；改了 `packages/shared` 也要重開 Vite。

### 已知問題與踩過的坑

- dev 資料有一筆舊規則留下的「我還對方 +$1」（對方欠我時記的），不會自動修正，開發者可自行刪除。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**：預設編碼會把 UTF-8 中文變亂碼（本 session 踩過，已從 git 還原）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時仍會只貼上不送出，派工後要讀畫面、補 `orca terminal send --enter`（`docs/orca-multi-agent.md` §4 已記）。
