# 2k 任務清單

plan：`tasks/phase-2k-plan.md`；spec：`docs/specs/phase-2k-home-redesign.md`。全部是網頁，worker 都是 Codex（`default` 角色）。

- [ ] **D0 docs PR 與整合分支**（協調者）：plan §0、§2 第 1 步。
      驗收：spec、plan、todo、`docs/handoff.md`、`docs/handoff/stats-2j.md` 以 docs PR 合進 `main`；整合分支 `feature/phase-2k-home-redesign-impl` 從 `origin/main` 開出，`pnpm install` 完成。
- [ ] **W1 共用失效函式**（依賴 D0；`2k-invalidate`）：plan §1.1。
      驗收：`invalidate-after-money-write.test.ts` 列出 12 個前綴，用真正的 hook query key 比對（不同帳本、期間、`LEDGER`／`MINE`、標註 `expanded` 兩種）；真的 `QueryClient` 驗證 active 重抓、inactive 標 stale、無關 key 不動；plan §1.1.1 矩陣的 51 個 mutation 各有「呼叫」或「沒有呼叫」的測試；保留的自有 key 各斷言一次；PR 描述附矩陣，跟預設值不同的逐條說明；沒有改任何 `staleTime`；Web 檢查全綠。
- [ ] **W2 首頁卡片元件**（依賴 D0；`2k-home-cards`）：plan §1.2。
      驗收：`AssetCard`、`HomeAccountList`、`HomeCategorySection`、`DebtsCard` 只吃 props、不打 API；帳戶頁的 `AccountList` 沒動；元件測試涵蓋 W262～W265、SC-H5、H7、H8 的內容與互動、H9 顯示部分（`balance` 與 `totalBalance` 正負不同的資料）、H10；Web 檢查全綠。
- [ ] **W4 配色設定**（依賴 D0；`2k-color-setting`）：plan §1.3。
      驗收：配色 store 用 `useSyncExternalStore`，兩個訂閱者同時更新、取消訂閱、寫入失敗仍通知的測試通過；測試之間會重置 store；缺值、非法值、讀寫丟例外各有測試；`homeCategoryColor` 三種模式乘深淺兩種主題，金色時固定分組與未分類是中性灰；設定彈窗的 radiogroup、方向鍵、roving tabindex、示意條顏色、不發請求有測試；`StatsPage` 加金色、灰色不影響統計頁顏色的斷言，既有測試全綠；Web 檢查全綠。
- [ ] **W3 首頁組裝**（依賴 W1、W2、W4；`2k-home-page`）：plan §1.4。
      驗收：`Dashboard` 不再用 `key={ledger.id}`，表單 `key` 帶帳本 id；`useAccounts` 的 context 只由 `LedgerView` 提供；SC-H2 用真的 `QueryClient`＋真的 `PendingCard` 與表單，切帳本後 `/accounts`、`/accounts/balance-trend`、`/counterparties?nonZero`、`/counterparties?askMerge`、`/ledger-groups?unpointed`、標註列表的增量都是 0；帳戶 context 的卸載再掛載、invalidate、首次載入與錯誤各有測試；B 帳本回應延遲時 A 的最近交易不能操作，其他 `keepPreviousData` 的 hook 確認結果寫進 PR 描述；右側欄目標 A→B→A 不出現舊目標、跨帳本動作在 rerender 後仍正確、同帳本重抓不清表單；SC-H3 寫入後各重抓一次、重抓期間仍是舊數字，PR 描述附請求增量；SC-H12 打開的是補帳戶表單、請求帶原帳本 id；H4、H6、H11、H15、H16、H17、H18 首頁部分通過；`AccountBalances` 與它的測試已刪，提到它的註解已改；`HomePage.tsx` 檔頭與 `Dashboard` 註解已更新；交易頁、帳戶頁既有測試全綠；Web 檢查全綠。
- [ ] **W5 Web e2e**（依賴 W3；`2k-web-e2e`）：plan §1.5。
      派工前：確認沒有別的 worktree 正在跑 Web e2e，3100、5273、5274 沒有被佔。
      驗收：`home.spec.ts` 涵蓋 SC-H1、H3、H8 的寬度（439／440px、右側欄打開）、H13（含標註超過 10 筆展開、量 SVG 本身與點位方框）、H14（390px 淺色與深色）、H18（含統計頁不變）；既有 e2e 跟著新版面改了選擇器，沒刪掉驗證的行為；兩套 Web e2e 全綠。
- [ ] **D1 整體驗收、PR、部署**（協調者）：plan §4。
      驗收：diff 沒有 `apps/api`、`packages/shared`、相依套件的改動；自己重跑 SC-H2、SC-H3 並看請求增量；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；390px 與 1280px、淺色與深色、三種配色的截圖逐項對過 W260～W271；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；dev 照 plan §4 點過一次；worker 都 `worker-release`，worktree、子分支、`ledger_2k_web_e2e_test` 清掉；plan 與 todo 移到 `tasks/archive/`。
