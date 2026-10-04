# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-04，3d 交易頁整理與分類圖示）

### 現況

- **3c-0**（#87）：全系統金額改用「分」（0.01 元）。前端只透過 `@ledger/shared` 的 `formatMoney`／`parseMoneyInput`／`centsToInput` 換算。
- **3c 代墊與分帳**（#88～#92）：spec `docs/specs/phase-3c-split.md`（決策 82～110）、`phase-3c-web.md`（W62～W92）。份額計算只在 `packages/shared/src/split-shares.ts`。
- **3d 交易頁整理與分類圖示**（#96，修訂 #97、#98）：spec `docs/specs/phase-3d-tx-list.md`（T1～T14）。`Category.icon` 存 `CATEGORY_ICONS` 的代號，代號對圖示只在 `apps/web/src/components/CategoryIcon.tsx`。交易列固定兩行：上分類、下名稱；圖示放淡金圓底。
- Orca Run `run_e2035b727bd0`（3d）的兩個 Task 都完成、沒有未處理訊息，新 session 不必接。
- 開發者還沒完整操作過 3c 分帳的畫面。

### 下一步

1. 建議開發者先操作 3c 分帳畫面，收回饋，照 `CLAUDE.md` §5 先改 spec 再動工。
2. 之後的方向已提給開發者，**還沒選**：
   - A（協調者建議）共享帳本的分帳畫面與成員結清（3c 決策 87）。
   - B 統計報表（3b §9、3c §9 都在等它）。
   - C 收尾階段三，進入階段四 AI 文字記帳。
   - D 零碎項目：每日小計、i18n 實作、份數分帳、多人一起付款。
3. 待開發者回覆：改 Vite 設定，讓 `packages/shared` 變更後預先打包快取自動失效，免得開發者每次都要勾「Disable cache」。

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
