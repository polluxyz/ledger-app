# Session 交接

每次換 session 就更新這一份，**只寫重點**，細節連到 spec、plan 或 PR。新 session 第一件事讀它。
程序見 `docs/orca-multi-agent.md` §6；新 session 一律用 `claude --dangerously-skip-permissions` 開。

---

## 最新交接（2026-10-03，3c-0 金額改成分、3c 代墊與分帳）

### 現況

- **3c-0**（#87）：全系統金額改用「分」（0.01 元）存放與傳遞。spec：`docs/specs/phase-3c0-money-cents.md`；紀錄：`tasks/archive/phase-3c0-plan.md`。前端只透過 `@ledger/shared` 的 `formatMoney`／`parseMoneyInput`／`centsToInput` 換算。
- **3c 代墊與分帳**（後端與畫面同一個 PR）：spec `docs/specs/phase-3c-split.md`（決策 82～107）、`phase-3c-web.md`（W62～W88）；紀錄 `tasks/archive/phase-3c{,-web}-plan.md` §6。份額計算只在 `packages/shared/src/split-shares.ts`（後端以它為準，前端只預覽）。
- 開發者指示「平行進行、等完成再叫我」，3c 的後端 plan 與畫面 spec 由協調者自行核可。**開發者還沒操作過 3c 的畫面**，下一步是收回饋。

### 下一步

1. 開發者操作 3c 畫面後的回饋；照 `CLAUDE.md` §5 先改 spec 再動工。
2. 延後項目（spec 3c §9）：共享帳本的分帳畫面與成員結清、訊息功能、多人一起付款、份數分帳。之後也可能收尾階段三進入階段四。

### 開發者的偏好與約束（不在 spec 裡的）

- 回覆用繁體中文；金錢流程「不能繁瑣，但不能失去嚴謹」；介面文字極簡（W44）。
- 看到成果再調整：開發者先操作畫面再回饋，spec 視為活文件。
- **對象頁只管人（名單與資料），借還資訊只在交易頁**；管理按鈕也只在對象頁。
- **右側欄的叉叉一律直接收起**，不要退回新增表單，動畫裡也不能出現新增表單（同一問題回報過三次）。
- 單邊紀錄是「自己的紀錄」；牽涉到對方（連動）才需要警告或確認。畫面不出現「好友」。
- **worker 順序：Codex（`gpt-6-luna` max）優先**。開發者 09-28 曾改成 GLM 優先，09-29 又改回 Codex；以 `CLAUDE.md` §11 為準。
- 開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD，跟 `origin/main`）跑：API 用 `node dist/main`、不是 watch。後端或 `packages/shared` 有改：替他 `git checkout --detach origin/main`、`pnpm --filter @ledger/shared build`、`apps/api` 的 `pnpm build`（有 migration 再 `prisma migrate deploy`），然後請他重開 API 與 Vite。只改前端時 Vite 會自動更新，請他按 `Ctrl + Shift + R`。

### 已知問題與踩過的坑

- **worker 的 worktree 會帶著 `apps/api/.env`（指向開發者的 `ledger_dev`）**。2026-10-03 3c 的 migration 在 PR 合併前就被套用到 `ledger_dev`（14:40），最可能是後端 worker 沒帶 `.env.test` 跑了 Prisma 的 migration 指令。這次只新增資料表與欄位，資料總和前後一致，沒有損害。**之後派後端 worker 的 Task spec 一律加一條**：Prisma 的 `migrate`／`db` 指令只能對 `.env.test` 的資料庫跑，不准對 `.env`。
- 替開發者部署時，`pnpm install --frozen-lockfile` 不一定會重跑 `prisma generate`；schema 有變就在 `apps/api` 手動跑一次再 build，否則 build 會因為舊的 Prisma Client 報一堆型別錯誤。

- **改了 `packages/shared` 之後，本機 Vite 的預先打包快取（`apps/web/node_modules/.vite`）要刪掉**，否則 dev 與 Web e2e 會出現「xxx is not a function」。替開發者部署時也要刪 `web-redesign` 的。
- shared 的測試用 Node 內建 test runner 直接跑 `.ts`（型別剝除）：被測檔只能 `import type`，不帶副檔名的值匯入會解析不到（`split-shares.ts` 因此自己定義 `SPLIT_RATIO_TOTAL`）。
- 共享帳本的其他成員看到分帳時是一筆一筆的交易（`split` 為 `null`，spec 3c SC-S16）；合併顯示只給擁有者。

- **借還交易本身的 `note` 一律是 `null`**，備註存在往來紀錄上（`Transaction.debt.note`）。顯示或編輯借還交易的備註要用後者。
- **右側欄收起時內容不卸載**（#84）。新增打開右側欄的入口時，一定要先設定面板目標；列表的選取標示要配合 `isOpen`。
- Orca 重開後，舊的 `check --wait` 會留下「waiter_exists」而一直回空結果。改用 `worker-list` 的 `projection.outcome` 輪詢，或等舊 waiter 逾時。
- `worker-start --terminal` 用自己開的終端機時，`worker-stop` 關不掉程序，要再 `orca terminal close`。
- 主工作區 `git pull` 之後若 typecheck 報 shared 欄位不存在，是 `packages/shared/dist` 舊了：跑 `pnpm --filter @ledger/shared build`。
- `prisma migrate dev` 在 agent 的非互動環境不能跑：用 `prisma migrate diff --from-schema <舊> --to-schema <新> --script` 產生 SQL。
- **不要用 PowerShell 的 `Get-Content`／`Set-Content` 改含中文的檔案**（編碼會壞）。改檔用 Edit 工具或 Bash。
- Codex worker 用 `worker-start --terminal` 時偶爾只貼上不送出：派工後讀畫面，必要時補 `orca terminal send --enter`。
