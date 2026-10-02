# 3c-0 任務清單

plan：`tasks/phase-3c0-plan.md`；spec：`docs/specs/phase-3c0-money-cents.md`。

- [ ] **T1 shared 金額工具**（協調者）：`money.ts`、Node 內建 test runner 的設定、單元測試。
      驗收：先看到紅燈再實作；`pnpm --filter @ledger/shared test` 全綠，涵蓋 spec §4 的每個例子與 SC-M7（含 `"0.3"` → `30`、`"1.234"` → `null`、`"-5"` 預設 → `null`）；`pnpm --filter @ledger/shared build` 的 `dist` 不含測試檔。
- [ ] **T2 後端**（依賴 T1；Codex `gpt-6-sol` xhigh）：migration（4 個欄位 ×100）、DTO 上下限、OpenAPI 說明與 example、shared 型別改用 `Cents` 並更新註解。
      驗收：API 單元測試與 API e2e 全綠；新增 e2e 證明 SC-M5（上下限邊界）、SC-M6（期初 2,000 萬＋收入 2,000 萬，餘額 4,000 萬）；`prisma migrate status` 無 pending。
- [ ] **T3 Web**（依賴 T1；Codex `gpt-6-luna` max）：`lib/format.ts` 改以分為輸入；`TransactionForm`、`DebtEntryForm`、`DebtEntryEditDialog`、`AccountDialog` 改走 `parseMoneyInput`／`centsToInput`；元件測試與 Web e2e 用 API 建資料的金額 ×100。
      驗收：Web 單元測試與 Web e2e 全綠；元件測試證明輸入 `333.33` 送出 `33333`、`1.234` 不能送出（SC-M4）；Web e2e 證明 SC-M2（`−$333.33`）、SC-M3（`−$3,000`）；SC-M9 的 grep 沒有結果。
- [ ] **T4 合併與驗收**（依賴 T2、T3；協調者）：逐行看兩邊 diff；全套檢查；兩套 e2e 依序跑；SC-M1 手動比對；開 PR、盯 CI、合併；替開發者更新 dev 環境。
      驗收：plan §4 的 T4 清單全部通過；實作紀錄寫進 plan §7。
