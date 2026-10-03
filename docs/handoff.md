# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-03，3c-0 金額改成分、3c 代墊與分帳）

### 現況

- **3c-0**（#87）：全系統金額改用「分」（0.01 元）。spec `docs/specs/phase-3c0-money-cents.md`。前端只透過 `@ledger/shared` 的 `formatMoney`／`parseMoneyInput`／`centsToInput` 換算。
- **3c 代墊與分帳**（#88，之後 #90、#91 修畫面）：spec `docs/specs/phase-3c-split.md`（決策 82～107）、`phase-3c-web.md`（W62～W88）。份額計算只在 `packages/shared/src/split-shares.ts`，後端以它為準，前端只預覽。
- 開發者還沒完整操作過 3c 的畫面。

### 下一步

1. 收開發者操作 3c 畫面後的回饋，照 `CLAUDE.md` §5 先改 spec 再動工。
2. 延後項目（spec 3c §9）：共享帳本的分帳畫面與成員結清、訊息功能、多人一起付款、份數分帳。之後也可能收尾階段三、進入階段四。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。介面文字極簡（W44）。
- 開發者先操作畫面再回饋，spec 視為活文件。
- 對象頁只管人（名單與資料），借還資訊只在交易頁；管理按鈕也只在對象頁。
- 右側欄的叉叉一律直接收起，不要退回新增表單，動畫裡也不能出現新增表單（回報過三次）。
- 單邊紀錄是「自己的紀錄」；牽涉到對方（連動）才需要警告或確認。畫面不出現「好友」。
- worker 用哪個模型，以 `docs/orca-multi-agent.md` §0 的角色表為準。

### 替開發者部署

開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD，跟 `origin/main`）跑，API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. `git checkout --detach origin/main`。
  2. `pnpm --filter @ledger/shared build`，並刪掉 `apps/web/node_modules/.vite`。
  3. schema 有變：在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑）。有 migration 再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
