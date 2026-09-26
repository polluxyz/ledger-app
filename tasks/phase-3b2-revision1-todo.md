# 任務清單：3b-2 修訂 1

> 依據：`tasks/phase-3b2-revision1-plan.md`。後端 worker：Codex `gpt-6-sol` xhigh；畫面 worker：Codex `gpt-6-luna` max 優先（`CLAUDE.md` §11）。A2、A4～A6 同一個 worker 依序做（改同一批檔案）；B1 完成後 B2、B3 與後端 worker 平行。

| #   | 任務                                                                                                                            | 負責          | 相依   |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------ |
| A1  | shared 契約：`name` 可為 null、`displayName`、`askMerge`、`LinkAccepted`、拿掉 `forLink`／`counterpartyId`、`MERGE_NOT_ALLOWED` | worker（sol） | —      |
| A2  | schema + migration                                                                                                              | worker（sol） | A1     |
| A3  | 隔離測試先行（SC-K26）                                                                                                          | worker（sol） | A2     |
| A4  | 邀請不綁人、接受自動建立對象與待詢問（決策 73～75）                                                                             | worker（sol） | A3     |
| A5  | 暱稱、`displayName`、搜尋、合併、清標記、解除連動的名字、提議名字（決策 76～81）                                                | 協調者        | A3     |
| A6  | 後端 e2e（SC-K19～K27）與 3a 的 friends e2e 改寫                                                                                | 協調者        | A4、A5 |
| B1  | hooks、錯誤訊息、Web 編譯通過                                                                                                   | 協調者        | A1     |
| B2  | 對象頁、側欄、路由、邀請視窗（W45～W48、§10.2）                                                                                 | worker        | B1     |
| B3  | 往來帳管理按鈕、暱稱／合併／詢問視窗、文案精簡（W49、W51、§10.2）                                                               | worker        | B1     |
| B4  | 待確認卡片與邀請頁：不選人、詢問（W50）                                                                                         | worker        | B3     |
| B5  | web e2e 與整體驗收                                                                                                              | 協調者        | 全部   |

## 驗收

- **A1**：`pnpm --filter @ledger/shared build` 通過。
- **A2**：`prisma migrate status` 無 pending；`name = null` 可寫入；兩個 `counterpartyId` 欄位已移除。
- **A3**：隔離測試先紅燈。
- **A4**：SC-K19；決策 57、61 的 409 在新端點維持。
- **A5**：SC-K20～K25 的單元測試通過。
- **A6**：`debt-linking`、`debt-linking-isolation`、`friends` e2e 全綠；SC-K27 回歸。
- **B1**：`pnpm typecheck` 全綠；hooks 測試驗證路徑、body 與快取失效。
- **B2**：SC-W51、W52 的元件測試；對象頁沒有欠款文字。
- **B3**：暱稱、合併、詢問三個視窗的文字與 §10.2 一致、沒有多餘說明段；管理按鈕依連動與否切換；SC-W56 的元件部分。
- **B4**：SC-W53、W54、W57 的元件部分；接受請求不帶 body。
- **B5**：SC-W51～W59 的 e2e；所有新彈窗通過 `expectNoHorizontalOverflow`；完整 CI 綠。
