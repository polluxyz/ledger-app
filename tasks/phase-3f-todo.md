# 3f 任務清單

plan：`tasks/phase-3f-plan.md`；spec：`docs/specs/phase-3f-unified-debts.md`。

- [x] **F0 契約與隔離測試**（協調者）：plan §1.1、W137 導覽型別；開 `feature/unified-debts`。
      驗收：`pnpm --filter @ledger/shared build` 通過；`unified-debts-isolation.e2e-spec.ts` 紅燈（端點或行為還不存在）；API／Web typecheck 只剩「新欄位未實作」的錯誤。
- [x] **F1 schema＋指向**（依賴 F0；`uf-schema`，與 F2～F7 平行）：plan §1.2 第 1、3 項。
      驗收：`prisma migrate status` 無 pending；SC-F3、F4、F5 的 API e2e 通過；隔離測試的指向部分轉綠。
- [x] **F2 退出後唯讀**（依賴 F0；`uf-left`）：plan §1.2 第 2 項。
      驗收：隔離測試的退出部分轉綠；guard 單元測試涵蓋「沒標裝飾器」「標 read」「標 reject」「從沒加入」四種；既有 e2e 不變。
- [x] **F3 純函式**（依賴 F0；`uf-shared`）：plan §1.3。
      驗收：`pnpm --filter @ledger/shared test` 全綠，含花蓮三日的數字（小明 +51200、小華 +139400、小美 0）。
- [x] **F4 對象頁**（依賴 F0；`uf-people-dir`）：W130～W133。
      驗收：元件測試；`pnpm --filter @ledger/web test / typecheck` 全綠。
- [x] **F5 借還頁**（依賴 F0；`uf-debts`）：W134～W136、W138、W139、W137 送出端。
      驗收：元件測試涵蓋兩清不列（前端不過濾，只驗它照 API 顯示）；Web 檢查全綠。
- [x] **F6 帳本頁成員**（依賴 F0；`uf-members`）：W140～W146。
      驗收：元件測試涵蓋使用者關掉動畫時選項直接出現；Web 檢查全綠。
- [x] **F7 結清與唯讀畫面**（依賴 F0；`uf-settle`）：W137 接收端、W147、W148。
      驗收：元件測試；唯讀畫面沒有新增、編輯、刪除、結清入口。
- [x] **F8 總額與帳本群組**（依賴 F1、F3；`uf-balances`）：plan §1.2 第 4 項。
      驗收：SC-F1、F2、F6、F7 與 SC-F9 的金額部分；3e 的結清 e2e 數字不變；隔離測試全綠。
- [x] **F9 新增成員的兩種入口**（依賴 F1；`uf-members-api`，與 F8 平行）：plan §1.2 第 5 項。
      驗收：SC-F8。
- [x] **F10 API 情境 e2e 與回歸**（依賴 F1、F2、F8、F9；`uf-api-e2e`）。
      驗收：`unified-debts.e2e-spec.ts` 走完 SC-F1～F9；全部 API e2e 全綠。
- [x] **F11 Web e2e**（依賴 F4～F10 全部 merge；`uf-web-e2e`）。
      驗收：主線通過；既有 Web e2e 全綠。
- [ ] **F12 驗收與合併**（協調者）：plan §4 全部；開 PR、盯 CI、合併；替開發者部署；實作紀錄寫進 plan §6；spec §8 標「由 3f 取代」的舊決策。
      驗收：SC-F11、F12；PR 合併；dev 資料庫 migrate 完成。
