# 3e 後端任務清單

plan：`tasks/phase-3e-plan.md`；spec：`docs/specs/phase-3e-shared-split.md`。

- [ ] **E0 shared 契約與隔離測試**（協調者）：plan §1 的 shared 部分；`ledger-splits-isolation.e2e-spec.ts`。
      驗收：`pnpm --filter @ledger/shared test` 全綠（含 3c 原有 80 個與新的 `computeLedgerNets`／`suggestSettlements`）；隔離測試紅燈（端點不存在）；`pnpm --filter @ledger/shared build` 後 API 與 Web 的 typecheck 只剩「新欄位還沒實作」的錯誤。
- [ ] **E1 schema＋migration**（依賴 E0；worker）：plan §1 第 1 項。
      驗收：`prisma migrate status` 無 pending；SQL 含部分唯一索引、3 組 CHECK、回填；在 e2e 資料庫對一份有共享帳本的資料跑過，SC-E1 的回填數量正確。
- [ ] **E2 帳本裡的人**（依賴 E1；worker）：plan §1 第 2 項。
      驗收：SC-E10；離開→加入不多出一筆；隔離測試的 people 部分轉綠。
- [ ] **E3 交易端點與補帳戶端點**（依賴 E2；worker）：plan §1 第 3、4 項。
      驗收：SC-E2、E3、E7、E8、E11、E12、E13、E15；改付款人的帳戶規則有單元測試。
- [ ] **E4 結清與 summary**（依賴 E3；worker）：plan §1 第 5 項。
      驗收：SC-E4、E5、E6、E9、E14；隔離測試全綠（SC-E17、E18）。
- [ ] **E5 e2e 與回歸**（依賴 E4；worker）：plan §1 第 6 項。
      驗收：`ledger-splits.e2e-spec.ts` 全綠；SC-E19 的既有 e2e 全綠；`pnpm --filter @ledger/web typecheck` 通過。
- [ ] **E6 驗收與合併**（依賴 E5；協調者）：逐行看 diff；plan §4 全部通過；開 PR、盯 CI、合併；替開發者更新 dev 環境；實作紀錄寫進 plan §6。
      驗收：SC-E20；PR 合併；dev 資料庫 migrate 完成。
- [ ] **E7 畫面 spec**（依賴 E6；協調者）：寫 `docs/specs/phase-3e-web.md` 送開發者審。
