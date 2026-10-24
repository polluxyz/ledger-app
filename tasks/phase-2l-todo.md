# 2l 任務清單

plan：`tasks/phase-2l-plan.md`；spec：`docs/specs/phase-2l-home-layout.md`。網頁的 worker 都是 Codex（`default` 角色）；PR2 的後端是 `backend` 角色。

## docs

- [ ] **D0 docs PR**（協調者；`feature/home-design-align`）：plan §0。
      驗收：spec、plan、todo、`docs/handoff.md`（`stats-2j` 那一列、編號分段登記 313～335、W272～W287、`SC-Y`）、`docs/handoff/stats-2j.md` 合進 `main`；CI 全綠。

## PR1：A+ 版面（`feature/2l-home-aplus`）

- [ ] **S1 共用型別與預設版面**（協調者；依賴 D0）：plan §1.1。
      驗收：`packages/shared/src/types/home-layout.ts` 照 spec §3.2；`index.ts` 匯出；`pnpm --filter @ledger/shared build` 通過；沒有驗證函式。
- [ ] **W-A1 版面渲染與卡片拆分**（依賴 S1；`2l-aplus`）：plan §1.2。
      驗收：卡片登記表 8 張卡，最小寬度實測後填；`HomeCard` 外框統一；渲染器吃 `DEFAULT_HOME_LAYOUT_V1`；`wrapSplit` 純函式有單元測試（剛好放得下、差 1px、全部換行）；待處理卡在第 1 根列後；≤900px 與沒有帳本走固定版面；`trend` 有總資產、共享帳本標「我的總資產」；`categories` 每類兩行加進度條；`accounts` 獨立；`debts` 用 `HomeBalanceSummaryArrow`，借還頁、交易頁、分帳、結清的箭頭測試沒改；金色規則照決策 315；帳戶清單用 container query；預設版面每張卡一次、權重加總 10000 的測試；SC-Y4～Y7、Y25 有元件測試；2k 的 SC-H2、H3 請求增量測試照樣過；Web 檢查全綠。
- [ ] **W-A2 PR1 Web e2e**（依賴 W-A1；`2l-aplus-e2e`）：plan §1.3。
      派工前：確認沒有別的 worktree 正在跑 Web e2e，3100、5273、5274 沒有被佔。
      驗收：`home.spec.ts` 涵蓋 SC-Y1、Y2、Y3、Y8、Y4 的趨勢卡高度；2k 的 SC-H14 照樣過；兩套 Web e2e 全綠；截圖 1280／390px、淺深色、三種配色交回。
- [ ] **D1 PR1 驗收、PR、部署**（協調者）：plan §1.4。
      驗收：diff 沒有 `apps/api`、沒有新套件；自己重跑 SC-H2、H3；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；截圖逐張對過；PR 依模板、CI 全綠、squash merge；部署 dev，提醒 `Ctrl + Shift + R`；開發者看過。

## PR2：伺服器儲存（`feature/2l-home-layout-api`）

- [ ] **S2 紅燈測試**（協調者；依賴 D1）：plan §2.1。
      驗收：`home-layout.test.ts` 涵蓋 spec §3.2、§3.3 每一條；`home-layout-isolation.e2e-spec.ts` 涵蓋 SC-Y10、Y13；兩支都跑過、確認紅燈。
- [ ] **B1 驗證函式、資料表、API**（依賴 S2；`2l-layout-api`；`backend`）：plan §2.2。
      驗收：S2 兩支轉綠；migration 只建表、enum、外鍵；PUT 用條件更新與 `P2002`，沒有先讀再寫；有測試證明 `layout` 樹裡的鍵沒被 `whitelist` 剝掉；SC-Y11（含兩組並發）、SC-Y12 的 6 條 400 且資料庫不變；`HOME_LAYOUT_REVISION_CONFLICT` 加進 `error-codes.ts`；OpenAPI 有兩個端點；API 檢查與 API e2e 全綠。
- [ ] **D2 PR2 驗收、PR、部署**（協調者）：plan §2.3。
      驗收：逐行看 migration SQL、service、controller、DTO；隔離與並發 e2e 自己各跑 3 次；全部檢查全綠；PR 依模板、CI 全綠、squash merge；部署 dev（先 migration）。

## PR3：編輯模式（`feature/2l-home-layout-edit`）

- [ ] **C0 拖動套件檢查點**（依賴 D1，可與 PR2 平行；`spike/2l-dnd`，不合併）：plan §3.1。
      派工前：向開發者確認試裝 3 個套件。
      驗收：spec §6.3 的 8 條各有過或不過與證據；兩個套件的整合成本；協調者選定並寫進 plan §6；跟開發者報告。
- [ ] **E1 版面運算**（依賴 D2；`2l-layout-ops`）：plan §3.2。
      驗收：`moveCard`、`canDrop`、`resizeSplit`、`resizeBand` 的單元測試涵蓋四方向、從各位置移出、收合、壓平、上下限；隨機 200 次移動的輸出都通過 `parseHomeLayoutV1`；Web 檢查全綠。
- [ ] **E2 編輯模式介面**（依賴 C0、E1；`2l-layout-edit`）：plan §3.3。
      驗收：新套件只有 C0 選定的、版本鎖定；套件只在轉接層；W280～W286 與決策 325～329 有元件測試；SC-Y22、Y24 照樣過；Web 檢查全綠。
- [ ] **E3 PR3 Web e2e**（依賴 E2；`2l-layout-edit-e2e`）：plan §3.4。
      派工前：確認 Web e2e 的埠沒被佔。
      驗收：SC-Y14～Y21、Y23 有 e2e；兩套 Web e2e 全綠。
- [ ] **D3 PR3 驗收、PR、部署、收尾**（協調者）：plan §3.5。
      驗收：存出去的 JSON 都過驗證；自己用鍵盤走一次 SC-Y20；全部檢查全綠；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；部署 dev，提醒 `Ctrl + Shift + R`；worker 都 `worker-release`，worktree、子分支、測試資料庫清掉（drop 資料庫前先問）；plan 與 todo 移到 `tasks/archive/`。
