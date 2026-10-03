# 3c 後端任務清單

plan：`tasks/phase-3c-plan.md`；spec：`docs/specs/phase-3c-split.md`。

- [x] **B0 shared 契約與隔離測試**（協調者）：`types/split.ts`、`split-shares.ts` 與測試、debt／transaction 型別、錯誤碼；`splits-isolation.e2e-spec.ts`。
      驗收：`pnpm --filter @ledger/shared test` 80 個全綠；隔離測試 8 個紅燈（端點不存在）。
- [ ] **B1 schema + migration**（依賴 B0；worker）：spec §4、§4.1。
      驗收：`prisma migrate status` 無 pending；migration SQL 含 4 組 CHECK 與部分唯一索引。
- [ ] **B2 往來、提議、對象的調整**（依賴 B1；worker）：plan §1 第 4、5 項。
      驗收：單元測試涵蓋鏡像對照、接受時的 `record`／`categoryId`／`title` 規則；SC-S13 的往來部分。
- [ ] **B3 分帳的建立、讀取、修改、刪除、互轉**（依賴 B2；worker）：plan §1 第 2 項。
      驗收：逐人比對的純函式有單元測試；SC-S1～S4、S6～S12、S17 通過。
- [ ] **B4 交易端點**（依賴 B1；worker）：`title`、`split`、`debt.kind`、唯讀、列表合併、帳本真刪。
      驗收：SC-S13 的交易部分、SC-S14、SC-S18；分頁測試（21 筆分帳）。隔離測試 8 個全綠。
- [ ] **B5 合併與驗收**（依賴 B1～B4 與畫面的 W 系列；協調者）：逐行看 diff；全套檢查；兩套 e2e 依序跑；開 PR、盯 CI、合併；替開發者更新 dev 環境。
      驗收：plan §4 全部通過；實作紀錄寫進 plan §6。
