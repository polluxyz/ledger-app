# 任務清單：3b-1 往來帳版

> 依據：`tasks/phase-3b1-ledger-plan.md`。worker 依 `CLAUDE.md` §11：Codex（`gpt-6-luna` max）優先。

| #   | 任務                                         | 負責   | 相依   |
| --- | -------------------------------------------- | ------ | ------ |
| A1  | shared 契約                                  | 協調者 | —      |
| A2  | schema + migration                           | 協調者 | A1     |
| A3  | 隔離測試先行（SC-L11、SC-L12）               | 協調者 | A2     |
| A4  | 對象、往來紀錄、結清、免除                   | 協調者 | A3     |
| A5  | 交易端點與帳本刪除（§5.3）                   | 協調者 | A2     |
| A6  | 後端 e2e 改寫                                | 協調者 | A4、A5 |
| B1  | `use-debts.ts` 改寫＋錯誤訊息                | 協調者 | A1     |
| B2  | 借還分頁表單（spec web §4.1）                | worker | B1     |
| B3  | 借還檢視＋對象往來帳（§4.2、§4.3）           | worker | B1     |
| B4  | 明細的對象名字、右側欄保留旗標（§4.4、§4.5） | worker | B2、B3 |
| B5  | web e2e 與整體驗收                           | 協調者 | 全部   |

## 驗收

- **A1**：`pnpm --filter @ledger/shared build` 通過。
- **A2**：`prisma migrate status` 無 pending；手動插入違反 CHECK 的列會被擋。
- **A3**：隔離測試先紅燈。
- **A4**：SC-L1～L8、L13、L14 的單元測試通過。
- **A5**：SC-L9、L10、L12、L15 通過；既有交易測試維持綠燈。
- **A6**：`debts.e2e-spec.ts`、`debts-isolation.e2e-spec.ts` 覆蓋 SC-L1～L15。
- **B1**：hooks 測試驗證路徑、body 與快取失效（對象、往來紀錄、交易、帳戶）。
- **B2**：SC-W20～W23、W28 的元件測試。
- **B3**：SC-W24～W26 的元件測試。
- **B4**：SC-W27；SC-44 的既有 e2e 維持綠燈。
- **B5**：SC-W20～W30；完整 CI 綠。
