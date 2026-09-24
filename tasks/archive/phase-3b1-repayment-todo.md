# 任務清單：3b-1 往來帳版修訂 1（還款合併）

> 依據：`tasks/phase-3b1-repayment-plan.md`。worker 依 `CLAUDE.md` §11：Codex（`gpt-6-luna` max）優先。

| #   | 任務                                | 負責   | 相依   |
| --- | ----------------------------------- | ------ | ------ |
| A1  | shared 契約（種類、錯誤碼）         | 協調者 | —      |
| A2  | 還款規則純函式＋單元測試            | 協調者 | A1     |
| A3  | service：對象鎖、方向、超額檢查     | 協調者 | A2     |
| A4  | 後端 e2e（SC-L3 改寫、SC-L17～L21） | 協調者 | A3     |
| B1  | Web 表單 3 種類、還款方向與提示     | worker | A1     |
| B2  | web e2e 改寫與整體驗收              | 協調者 | A4、B1 |

## 驗收

- **A1**：`pnpm --filter @ledger/shared build` 通過；`COLLECT`、`REPAY` 不在 `POST` 可接受的種類裡。
- **A2**：單元測試涵蓋 spec §3.2.1 表格的 6 列。
- **A3**：`debt-entries.service.spec.ts` 綠；鎖用參數化的 `$queryRaw`。
- **A4**：SC-L3、SC-L17～L21 通過；既有 SC-L1～L16 維持綠燈。
- **B1**：SC-W31～W34 的元件測試；代付既有紀錄的顯示測試維持綠燈；協調者看完整 diff。
- **B2**：SC-W20～W34（修訂後）；完整 CI 綠。
