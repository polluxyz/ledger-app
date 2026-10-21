# 3l 任務清單

plan：`tasks/phase-3l-plan.md`；spec：`docs/specs/phase-3l-move-and-copy.md`。

- [x] **L0 契約與隔離測試**（總控）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`ledger-delete-move-isolation.e2e-spec.ts` 紅燈；API／Web typecheck 通過。
- [x] **L1 migration**（依賴 L0；`ldm-migrate`）：plan §1.2。
      驗收：`prisma migrate dev` 在自己的 `_test` 資料庫套用成功；重複標註被主鍵擋、刪交易時標註跟著刪（SQL 驗證）；既有 API e2e 全綠。
- [x] **L2 刪除私人帳本時搬走**（依賴 L0；`ldm-move`）：plan §1.3。
      驗收：單元測試涵蓋分組（SC-N6）、分類對應（SC-N5）、`moves` 的檢查（SC-N14）、中途失敗整筆回滾；SC-N1～N4、N14 的 API e2e 通過；隔離測試 SC-N7 轉綠；3k 的退出 e2e 照舊全綠。
- [x] **L3 標註**（依賴 L1、L2；`ldm-mark`）：plan §1.4。
      驗收：SC-N10～N13 的 API e2e 通過；隔離測試 SC-N12 轉綠；所有回傳 `Transaction` 的端點都帶 `marked`；交易列表 API < 500ms。
- [x] **L4 刪除對話框**（依賴 L0；`ldm-web-del`）：plan §1.5。
      驗收：元件測試涵蓋 W194、W195（含「×」「修改」、選過的帳本灰掉、已在其他組的交易不出現）、刪除後數字上色、每次改組就重新取預覽且只顯示最新結果；3k 退出對話框的元件測試全綠；Web 檢查全綠。
- [ ] **L5 ⋯ 選單、複製、標註**（依賴 L0；`ldm-web-row`）：plan §1.6。
      驗收：元件測試涵蓋 W196～W200、SC-N8、SC-N9；Web 檢查全綠。
- [ ] **L6 Web e2e**（依賴 L2～L5；`ldm-web-e2e`）：plan §1.7。
      驗收：兩套 Web e2e 全綠，含 spec §6 的主線。
- [ ] **L7 整體驗收、PR、部署**（總控）：plan §4。
      驗收：隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；dev 備份後 `migrate deploy`，照 plan §4 點過一次；worktree、分支、測試資料庫清掉。
