# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-10-01，3b-2 修訂 2、3 與右側欄修正）

### 現況

- 3b-2 已做到修訂 3，全部合併。spec：`docs/specs/phase-3b2-web.md` §11（修訂 2）、§12（修訂 3）；實作紀錄在 `tasks/archive/phase-3b2-revision{2,3}-plan.md`。
  - #80：總覽「待確認」卡片每 30 秒輪詢（原本的已知問題，已解）。
  - #82（修訂 2）：對象頁只管人，右側欄「對象」只有資料與管理按鈕；交易頁往來帳只留帳。
  - #83（修訂 3）：交易頁與總覽右側欄關閉／取消／儲存都直接收起；明細點借還交易直接編輯那一筆。API：`Transaction.debt` 加 `paired`、`note`（只增欄位）。
  - #84：收起時內容保留到滑出動畫結束；`RightPanelProvider.close()` 把焦點還給打開它的元素。
- 開發者已確認畫面。沒有進行中的 PR、worker 或 worktree（Orca run `run_3caaf6182415` 已全部結清，不需接手）。

### 下一步

1. 等開發者操作後的回饋；照 `CLAUDE.md` §5 先改 spec 再動工。
2. 更後面：代墊／多人分帳（要改資料模型），或收尾階段三進入階段四。開發者還沒決定。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；金錢流程「不能繁瑣，但不能失去嚴謹」；介面文字極簡（W44）。
- 看到成果再調整：開發者先操作畫面再回饋，spec 視為活文件。
- **對象頁只管人（名單與資料），借還資訊只在交易頁**；管理按鈕也只在對象頁。
- **右側欄的叉叉一律直接收起**，不要退回新增表單，動畫裡也不能出現新增表單（同一問題回報過三次）。
- 單邊紀錄是「自己的紀錄」；牽涉到對方（連動）才需要警告或確認。畫面不出現「好友」。
- **worker 順序：Codex（`gpt-6-luna` max）優先**。開發者 09-28 曾改成 GLM 優先，09-29 又改回 Codex；以 `CLAUDE.md` §11 為準。
- 開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD，跟 `origin/main`）跑：API 用 `node dist/main`、不是 watch。後端或 `packages/shared` 有改：替他 `git checkout --detach origin/main`、`pnpm --filter @ledger/shared build`、`apps/api` 的 `pnpm build`（有 migration 再 `prisma migrate deploy`），然後請他重開 API 與 Vite。只改前端時 Vite 會自動更新，請他按 `Ctrl + Shift + R`。

### 已知問題與踩過的坑

- **借還交易本身的 `note` 一律是 `null`**，備註存在往來紀錄上（`Transaction.debt.note`）。顯示或編輯借還交易的備註要用後者。
- **右側欄收起時內容不卸載**（#84）。新增打開右側欄的入口時，一定要先設定面板目標；列表的選取標示要配合 `isOpen`。
- Orca 重開後，舊的 `check --wait` 會留下「waiter_exists」而一直回空結果。改用 `worker-list` 的 `projection.outcome` 輪詢，或等舊 waiter 逾時。
- `worker-start --terminal` 用自己開的終端機時，`worker-stop` 關不掉程序，要再 `orca terminal close`。
- 主工作區 `git pull` 之後若 typecheck 報 shared 欄位不存在，是 `packages/shared/dist` 舊了：跑 `pnpm --filter @ledger/shared build`。
- `prisma migrate dev` 在 agent 的非互動環境不能跑：用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**（編碼會壞）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時偶爾只貼上不送出：派工後讀畫面，必要時補 `orca terminal send --enter`。
