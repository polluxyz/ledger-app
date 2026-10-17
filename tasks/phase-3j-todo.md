# 3j 任務清單

plan：`tasks/phase-3j-plan.md`；spec：`docs/specs/phase-3j-ledger-delete-archive.md`。

- [x] **J0 契約與隔離測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`ledger-delete-archive-isolation.e2e-spec.ts` 紅燈；API／Web typecheck 通過。
- [x] **J1 後端 A：借還寫入權**（依賴 J0；`lld-api-a`）：plan §1.2。
      驗收：單元測試涵蓋 4 個寫入點的檢查與拒絕不檢查；SC-J1 的 API e2e 通過；既有 API e2e 全綠。
- [x] **J2 後端 B：取消封存、預覽、刪除**（依賴 J0；`lld-api-b`）：plan §1.3。
      驗收：單元測試涵蓋預覽與刪除一致、撤銷失敗時整筆回滾、刪除前的關聯處理、擋下順序；SC-J2～J5 的 API e2e 通過；隔離測試轉綠；既有 API e2e 全綠。
- [x] **J3 畫面**（依賴 J0；`lld-web`）：plan §1.4。
      驗收：元件測試涵蓋 SC-J7；Web 檢查全綠。
- [ ] **J4 Web e2e**（依賴 J1～J3；`lld-web-e2e`）：plan §1.5。
      驗收：兩套 Web e2e 全綠，含 spec §6 的主線。
- [ ] **J5 整體驗收、PR、部署**（協調者）：plan §4。
      驗收：隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；dev 部署後照 plan §4 點過一次；worktree、分支、測試資料庫清掉。
