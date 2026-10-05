# 3e 畫面任務清單

plan：`tasks/phase-3e-web-plan.md`；spec：`docs/specs/phase-3e-web.md`。

- [ ] **F0 契約、hook 與後端小改動**（協調者）：plan §1 協調者那一段。
      驗收：hook 測試全綠；`PanelTarget` 與 `onFillAccount` 型別在整合分支上；`ledger-splits.e2e-spec.ts` 的 SC-E14 改寫後全綠；隔離測試 18/18 綠；`pnpm typecheck` 通過。
- [ ] **F1 記帳表單**（依賴 F0；`lsw-form`，與 F2、F3 平行）：W98～W109。
      驗收：SC-W87～SC-W92、SC-W99 的元件測試；3c 的元件測試斷言沒改、全綠。
- [ ] **F2 結清與右側欄**（依賴 F0；`lsw-settle`，與 F1、F3 平行）：W110～W121、W125 的補帳戶表單。
      驗收：SC-W93～SC-W95、SC-W97 的元件測試；個人帳本只有「明細／借還」兩格。
- [ ] **F3 列表、帳本頁、錯誤訊息**（依賴 F0；`lsw-list`，與 F1、F2 平行）：W122～W129、W125 的「待補」標籤。
      驗收：SC-W96、SC-W97（標籤）、SC-W98 的元件測試；畫面沒有「已離開」「好友」字樣。
- [ ] **F4 Web e2e**（依賴 F1～F3 合併回整合分支；`lsw-e2e`）：SC-W100。
      驗收：`ledger-split.spec.ts` 綠；既有 Web e2e 全綠。
- [ ] **F5 驗收與合併**（依賴 F4；協調者）：plan §4 全部通過；開 PR、盯 CI、合併；替開發者部署；實作紀錄寫進 plan §6。
      驗收：SC-W101；PR 合併；開發者的 dev 環境更新完成。
