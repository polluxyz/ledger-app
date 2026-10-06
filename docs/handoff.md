# Session 交接

每次換 session 就更新這一份。只寫現況、下一步、開發者當場給的偏好，細節連到 spec、plan 或 PR。長期有效的坑寫進對應的 `CLAUDE.md` 或 `docs/orca-multi-agent.md`，不要堆在這裡。

程序見 `docs/orca-multi-agent.md` §6。

---

## 最新交接（2026-10-06，3f spec 已核可；下一步寫 plan 與 todo）

### 現況

- 3e 後端（#104）與畫面（#108）已合併；#110（借還箭頭的頭貼與「需要支付」）也已合併（另一個 session 做的）。
- 開發者操作 3e 後認為「借還」與「共享帳本結清」分兩處很混亂，提出 3f：**`docs/specs/phase-3f-unified-debts.md` 已核可**（2026-10-06，§10 照建議定案）。重點：
  - 結清檢視維持最少轉帳；借還頁的共享帳本部分＝結清轉帳裡我付或我收的那幾筆（決策 141～145）。
  - 「指向」：我把帳本裡的人指向我的對象，只有我看得到；帳號相同的連動對象自動指向（146～150）。新表 `LedgerPersonPointer`。
  - 帳本頁成員區改成單一清單、「非成員」改稱「虛擬成員」、「新增成員」滑出兩個選項（W140～W146）。
  - 退出帳本後保有唯讀存取，只看跟自己有關的帳（決策 151）。**這是授權規則變更，隔離測試要先寫。**
  - 已核可的 schema 與 API 變更都在 spec §3、§4。
- 預覽頁：`docs/artifacts/step-3f-preview.html`（不進版控；畫面細節以 spec 為準）。
- 測試帳號（dev 資料庫，密碼都是 `12345678`）：a@a.com（test）、b@b.com（小明）、c@c.com（小華）、d@d.com（小美，已離開花蓮三日）。帳本「花蓮三日（測試）」（連動，14 筆交易與 2 筆結清）、「家用（不連動測試）」（小華是 VIEWER）。全部用 dev API 建立。
- `web-redesign` worktree 停在 #109（detached），**還沒跟到 #110 與本 PR**。開發者沒要求更新；要更新照下方「替開發者部署」。
- Orca Run `run_74bbb80ec969` 的 worker 都已 release，沒有進行中的 Run。worktree `lsw-form`、`lsw-settle`、`lsw-list`、`lsw-e2e` 與資料庫 `ledger_test_lsw_*`、`ledger_lsw_*_test` 都可以清掉。`ledger-split-web` worktree 是上一個協調者寫文件用的，也可以重用或清掉。
- 待觀察：3e 第一次跑整套 Web e2e 時 API log 出現一次 `deadlock detected`，沒有測試失敗（`tasks/phase-3e-web-plan.md` §6 第 8 點）。

### 下一步

1. 寫 `tasks/phase-3f-plan.md` 與 `tasks/phase-3f-todo.md` 一起送審（`CLAUDE.md` §5）。建議拆法：協調者先做 shared 型別與 SC-F9、F10 隔離測試；`backend`（sol）做 migration、指向、退出後唯讀與 `/counterparties` 合併；`default`（luna）做對象頁、借還頁、帳本頁、結清卡片與 Web e2e。
2. 待開發者回覆：改 Vite 設定，讓 `packages/shared` 變更後預先打包快取自動失效。
3. 其他方向（B 統計報表、C 階段四、D 零碎項目）等 3f 之後再談。

### 開發者的偏好（不在 spec 裡的）

- 回覆用繁體中文。金錢流程「不能繁瑣，但不能失去嚴謹」。介面文字極簡（W44）。
- 開發者先操作畫面再回饋，spec 視為活文件。
- 共享帳本是「大家看同一份帳」；但**欠款要在借還頁統一看**（2026-10-06，3f）。同一個人的欠款不能分散在兩處。
- 對象頁只管人（名單與資料），借還資訊只在交易頁；管理按鈕也只在對象頁。
- 右側欄的叉叉一律直接收起，不要退回新增表單，動畫裡也不能出現新增表單（回報過三次）。
- 單邊紀錄是「自己的紀錄」；牽涉到對方（連動）才需要警告或確認。畫面不出現「好友」。
- 版面先給預覽頁（並排方案、可點的動畫）再寫 spec；開發者會逐點改版面細節（2026-10-06）。
- worker 用哪個模型，以 `docs/orca-multi-agent.md` §0 的角色表為準；sol 只給難或要求高準確的工作，能拆就拆、多派 worker（2026-10-04）。

### 替開發者部署

開發者的 dev 伺服器在 `web-redesign` worktree（detached HEAD，跟 `origin/main`）跑，API 用 `node dist/main`，不是 watch。

- 只改前端：Vite 會自動更新，請他按 `Ctrl + Shift + R`。
- 後端或 `packages/shared` 有改：
  1. `git checkout --detach origin/main`。
  2. `pnpm --filter @ledger/shared build`，並刪掉 `apps/web/node_modules/.vite`。
  3. schema 有變：在 `apps/api` 手動跑 `prisma generate`（`pnpm install --frozen-lockfile` 不一定會重跑）。有 migration 再跑 `prisma migrate deploy`。
  4. `apps/api` 跑 `pnpm build`，然後請他重開 API 與 Vite。
