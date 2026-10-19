# 3k 任務清單

plan：`tasks/phase-3k-plan.md`；spec：`docs/specs/phase-3k-leave-and-merge.md`。

- [x] **K0 契約與隔離測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`ledger-leave-merge-isolation.e2e-spec.ts` 紅燈；API／Web typecheck 通過。
- [x] **K1 migration**（依賴 K0；`lvm-migrate`）：plan §1.2。
      驗收：`prisma migrate dev` 在自己的 `_test` 資料庫套用成功；違反 spec §3 兩條 CHECK 的 INSERT 被擋；既有 API e2e 全綠。
- [x] **K2 退出後的規則**（依賴 K0；`lvm-rules`）：plan §1.3。
      驗收：單元測試涵蓋已退出的付款人與結清方不記帳戶、移除有帳的成員被擋、舊退出端點 409、只剩我一個時預覽可刪；SC-K4、SC-K9 的 API e2e 通過；隔離測試的對應部分轉綠；既有 API e2e 照新規則更新後全綠。
- [x] **K3 合併計畫、預覽、退出**（依賴 K1；`lvm-leave`）：plan §1.4。
      驗收：單元測試逐列涵蓋 spec §2.3、分類找到與新建、帳本轉入的對象選擇與重名、預覽與執行共用計畫、中途失敗整筆回滾；SC-K1～K3、K6～K8、K11 的 API e2e 通過；隔離測試其餘部分轉綠。
- [x] **K4 合併來的交易**（依賴 K1；`lvm-merged`）：plan §1.5。
      驗收：單元測試涵蓋決策 199、202；SC-K5 與決策 202 的 API e2e 通過；既有交易 e2e 全綠。
- [x] **K5 畫面**（依賴 K0；`lvm-web`）：plan §1.6。
      驗收：元件測試涵蓋 W188～W193，含選擇畫面每勾一次就重新取預覽、只顯示最新結果；歷史頁與它的路由已拿掉；Web 檢查全綠。
- [x] **K6 Web e2e**（依賴 K2～K5；`lvm-web-e2e`）：plan §1.7。
      驗收：兩套 Web e2e 全綠，含 spec §6 的主線。
- [ ] **K7 整體驗收、PR、部署**（協調者）：plan §4。
      驗收：隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；部署前跑 spec §8 的查詢；dev 備份後 `migrate deploy`，照 plan §4 點過一次；請 d@d.com、a2@a.com 用新流程退出；worktree、分支、測試資料庫清掉。
