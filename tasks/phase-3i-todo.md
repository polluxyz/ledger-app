# 3i 任務清單

plan：`tasks/phase-3i-plan.md`；spec：`docs/specs/phase-3i-debt-entry-edit.md`。

- [x] **I0 整合分支、契約與隔離測試**（協調者）：從 `main` 開 `feature/debt-entry-edit`；plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`debtCategoryTypeOf` 的 Node test 通過；`debt-entry-edit-isolation.e2e-spec.ts` 紅燈；API／Web typecheck 只剩「新欄位未實作」的錯誤。
- [x] **I1 後端**（依賴 I0；`dee-api`）：plan §1.2。
      驗收：單元測試涵蓋分類方向 4 種、分支跟著換帳戶、只改新欄位不送提議；SC-I1～I7 的 API e2e 通過；隔離測試轉綠；既有 API e2e 全綠。
- [x] **I2 畫面**（依賴 I0；`dee-web`）：plan §1.3。
      驗收：元件測試涵蓋 SC-I9；Web 檢查全綠。
- [x] **I3 Web e2e**（依賴 I1、I2；`dee-web-e2e`）：plan §1.4。
      驗收：兩套 Web e2e 全綠，含 spec §6 的主線。
- [x] **I4 整體驗收、PR、部署**（協調者）：plan §4。
      驗收：隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §8 的文件影響都改了；PR 依模板、CI 全綠、squash merge；dev 部署後照 plan §4 點過一次；worktree、分支、測試資料庫清掉。
