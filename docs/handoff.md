# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-04，3e 共享帳本的分帳與結清：spec 已核可、plan 待核可）

### 現況

- 3c-0、3c、3d 都已合併（細節見各 spec 與 `tasks/archive/`）。#100 修了篩選卡片的展開動畫。
- 開發者選了方向 A：**3e 共享帳本的分帳與結清**。spec `docs/specs/phase-3e-shared-split.md` 已核可並合併（#101，決策 111～140、SC-E1～E20）。
- 開發者在假設清單外另外定的：付款人可以從帳本裡的人選、預設自己（決策 117）；不在帳本裡的人用「非成員」（只有名字，決策 136～140）；沒補帳戶的那筆是付款人那邊一筆沒有帳戶的紀錄（決策 124）。spec §12 的 7 點照建議定案。
- `tasks/phase-3e-plan.md`、`tasks/phase-3e-todo.md` 已寫好，**還沒經開發者核可**。plan 對 spec 有一處補充：補帳戶改用兩個專用端點（plan §3 第 1 列），核可後要同步改 spec 的 SC-E3、E5、E17。
- 沒有進行中的 Orca Run 與 worker。
- 開發者還沒完整操作過 3c 分帳的畫面。

### 下一步

1. 請開發者核可 3e plan。核可後照 `tasks/phase-3e-todo.md` 從 E0 開始：協調者先做 shared 契約與隔離測試（分支 `feature/ledger-split`），再派 `backend` worker。
2. 後端合併後寫 `docs/specs/phase-3e-web.md`（畫面 spec，方向在 3e spec §7）送審。
3. 待開發者回覆：改 Vite 設定，讓 `packages/shared` 變更後預先打包快取自動失效。
4. 其他方向（B 統計報表、C 階段四、D 零碎項目）等 3e 之後再談。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。介面文字極簡（W44）。
- 開發者先操作畫面再回饋，spec 視為活文件。
- 共享帳本是「大家看同一份帳」，跟個人往來帳分開；個人帳仍以自己為主。
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
