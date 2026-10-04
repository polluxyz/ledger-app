# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-04，3e 後端已合併；下一步是畫面 spec）

### 現況

- 3e 共享帳本的分帳與結清：spec（#101）、plan 核可、**後端已合併（#104）**。實作紀錄與事故在 `tasks/phase-3e-plan.md` §6；todo E0～E6 已完成。
- 新端點：`/ledgers/{id}/people`、`/settlement-summary`、`/settlements`、兩個補帳戶的 `PUT …/account`（spec §5.5）。交易回應多 `payer`、`ledgerSplit`、`settlement`、`accountPending`。省略 `ledgerSplit`＝不分帳，所以現行 Web 行為不變。
- 開發者的 `ledger_dev` 已備份（`D:\Projects\ledger-app-backups\`）並 `migrate deploy`；`web-redesign` worktree 已跟到 `origin/main`、shared 與 API 已 build。**API 與 Vite 要開發者自己重開。**
- 派工規則改了（#103）：`backend`（sol）只給難或要求高準確的工作，其餘給 `default`（luna）；多派 worker 平行；派工前把 worker worktree 的 `.env`、`.env.test` 都改指向它專屬的測試資料庫。
- 沒有進行中的 Orca Run 與 worker（`run_4b955d94925d` 的 6 個 worker 都已 release）。
- 開發者還沒完整操作過 3c 分帳的畫面。

### 下一步

1. 寫 `docs/specs/phase-3e-web.md`（todo E7，方向在 3e spec §7）：動筆前先列假設清單請開發者確認，再送審。
2. 待開發者回覆：改 Vite 設定，讓 `packages/shared` 變更後預先打包快取自動失效。
3. 其他方向（B 統計報表、C 階段四、D 零碎項目）等 3e 畫面之後再談。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。介面文字極簡（W44）。
- 開發者先操作畫面再回饋，spec 視為活文件。
- 共享帳本是「大家看同一份帳」，跟個人往來帳分開；個人帳仍以自己為主。
- 對象頁只管人（名單與資料），借還資訊只在交易頁；管理按鈕也只在對象頁。
- 右側欄的叉叉一律直接收起，不要退回新增表單，動畫裡也不能出現新增表單（回報過三次）。
- 單邊紀錄是「自己的紀錄」；牽涉到對方（連動）才需要警告或確認。畫面不出現「好友」。
- worker 用哪個模型，以 `docs/orca-multi-agent.md` §0 的角色表為準；sol 只給難或要求高準確的工作，能拆就拆、多派 worker（2026-10-04）。

### 替開發者部署

開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD，跟 `origin/main`）跑，API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. `git checkout --detach origin/main`。
  2. `pnpm --filter @ledger/shared build`，並刪掉 `apps/web/node_modules/.vite`。
  3. schema 有變：在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑）。有 migration 再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
