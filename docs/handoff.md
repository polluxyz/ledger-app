# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-05，3e 畫面已合併；等開發者操作回饋）

### 現況

- 3e 共享帳本的分帳與結清：後端（#104）與**畫面（#108）都已合併**。畫面 spec `docs/specs/phase-3e-web.md`（W93～W129），實作紀錄在 `tasks/phase-3e-web-plan.md` §6。
- 開發者在假設清單時改了兩條後端決策（3e spec 修訂 2）：預設均分只勾**現任成員**；**已離開的人跟非成員一樣能被選**，畫面不標「已離開」。後端改動跟畫面同一個 PR。
- `web-redesign` worktree 已跟到 `origin/main`（#108）、shared 與 API 已 build；這次沒有 migration。**API 與 Vite 要開發者自己重開**，瀏覽器按 `Ctrl + Shift + R`。
- 測試資料庫名稱一定要以 `_test` 結尾（Web e2e 只肯清空這種），規則已寫進 `docs/orca-multi-agent.md` §3。
- Orca Run `run_74bbb80ec969` 的 5 個 worker 都已 release。留下的 worktree（`ledger-split-web`、`lsw-form`、`lsw-settle`、`lsw-list`、`lsw-e2e`）與資料庫（`ledger_test_lsw_*`、`ledger_lsw_*_test`）都已合併完、可以清掉。
- 待觀察：第一次跑整套 Web e2e 時 API log 出現一次 `deadlock detected`，沒有測試失敗，之後兩次都沒再出現（plan §6 第 8 點）。

### 下一步

1. 等開發者操作 3e 畫面（記帳表單的付款人與名單、結清檢視、補帳戶、非成員）後的回饋，照 spec 活文件流程調整。
2. 待開發者回覆：改 Vite 設定，讓 `packages/shared` 變更後預先打包快取自動失效。
3. 其他方向（B 統計報表、C 階段四、D 零碎項目）等 3e 回饋處理完再談。

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
