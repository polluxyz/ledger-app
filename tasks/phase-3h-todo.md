# 3h 任務清單

plan：`tasks/phase-3h-plan.md`；spec：`docs/specs/phase-3h-every-entry-has-account.md`。

- [x] **H0 整合分支、契約與隔離測試**（協調者）：從 `main` 開 `feature/every-entry-account`；plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`differenceLabelOf`、`forgivenessLabelOf` 的 Node test 通過；`every-entry-account-isolation.e2e-spec.ts` 紅燈；API／Web typecheck 只剩「新欄位未實作」與「`tracksBalance` 已移除」的錯誤。
- [x] **H1 migration、臨時帳戶、拿掉 tracksBalance**（依賴 H0；`eea-migration`）：plan §1.2 G1（`assertSelectableAccount` 已在 H0 寫好）。migration SQL 先給協調者，協調者列給開發者看，同意後才合進整合分支。
      驗收：`prisma migrate status` 無 pending；migration 前後比對（每個帳戶餘額、每個對象的往來餘額）一致，配不到的舊差額沒被動；臨時帳戶改名、刪除回 `409`；新註冊的使用者剛好一個臨時帳戶。
- [x] **H2 付款人帳戶規則改成臨時帳戶**（依賴 H0；`eea-payer`）：plan §1.2 G2。
      驗收：付款人規則單元測試涵蓋自己、別的成員、非成員、改付款人；SC-H8 的 API e2e 通過；隔離測試的臨時帳戶部分轉綠。
- [x] **H3 借還一律綁帳戶、分支、免除**（依賴 H0；`eea-debts`）：plan §1.2 G3。
      驗收：單元測試涵蓋少收、多收、少付、多付、剛好還清，斷言「還款 ± 分支 = 實收」與往來餘額 0；SC-H1、H3～H7、H14 的 API e2e 通過；隔離測試的分支與呆帳部分轉綠。
- [x] **H4 預設帶入**（依賴 H0；`eea-defaults`）：plan §1.2 G4。
      驗收：SC-H10 的 API e2e 通過；隔離測試的 `record-defaults` 部分轉綠；1 萬筆交易時回應 < 200ms（數字記進 plan §6）。
- [x] **H5 畫面：帳本、帳戶、交易表單**（依賴 H0；`eea-web-ledgers`）：plan §1.3 G5。
      驗收：元件測試涵蓋帳本對話框沒有「計入餘額」、帳戶頁的臨時帳戶有交易才顯示且不能改名刪除、交易表單與結清表單帶入這本帳本最近用的帳戶；Web 檢查全綠。
- [x] **H6 畫面：借還與明細**（依賴 H0；`eea-web-debts`）：plan §1.3 G6。
      驗收：元件測試涵蓋借還表單沒有「不記入帳本」且帶入預設、免除先選帳本、分支畫在還款下面且沒有「⋯」、呆帳的名稱、交易列顯示「臨時帳戶」；Web 檢查全綠。
- [x] **H7 API e2e**（依賴 H1～H4；`eea-api-e2e`）：plan §1.4 G7。
      驗收：`every-entry-account.e2e-spec.ts` 走完 SC-H1～H10、SC-H14；既有 API e2e 全綠。
- [x] **H8 Web e2e**（依賴 H1～H6；`eea-web-e2e`）：plan §1.4 G8。
      驗收：兩套 Web e2e 全綠，含 spec §6 的兩條主線。
- [x] **H9 整體驗收與 PR**（協調者）：plan §4。
      驗收：隔離測試由紅轉綠；`tracksBalance` grep 無結果；migration 前後比對自己重跑一致；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §8 的文件影響都改了；PR 依模板填寫、CI 全綠、squash merge。
- [ ] **H10 部署與收尾**（協調者）：plan §2 第 6、7 項。問開發者要不要部署；要的話先 `pg_dump`，刪測試資料，`migrate deploy`，重建情境。
      驗收：dev 的帳戶餘額核對一致；spec §1 的 1～7 點過一次；`orca worktree list` 沒有 `eea-*`；測試資料庫刪除清單給開發者看過；memory「階段三進度」更新。
