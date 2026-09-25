# 任務清單：3b-2 連動的畫面

> 依據：`tasks/archive/phase-3b2-web-plan.md`。worker 依 `CLAUDE.md` §11：Codex（`gpt-6-luna` max）優先。

| #   | 任務                                                                 | 負責   | 相依 | PR   |
| --- | -------------------------------------------------------------------- | ------ | ---- | ---- |
| A1  | shared 型別：`FriendRequest.counterpartyId`、`DebtProposal.previous` | 協調者 | —    | PR 1 |
| A2  | F25、F26 的 service 與後端 e2e                                       | 協調者 | A1   | PR 1 |
| A3  | 更新 `phase-3b2-linking.md` §5.2、§5.3                               | 協調者 | A2   | PR 1 |
| B1  | hooks、錯誤訊息、導覽到往來帳                                        | 協調者 | PR 1 | PR 2 |
| B2  | 下拉選單、新增對象、借還表單提示、清單標籤（spec §4.1、§4.2、W33）   | worker | B1   | PR 2 |
| B3  | 往來帳連動區塊、邀請視窗、同步標籤、警告（§4.3、§4.4）               | worker | B1   | PR 2 |
| B4  | 總覽的待確認卡片（§4.5）                                             | worker | B2   | PR 2 |
| B5  | 邀請頁 `/invite`（§4.6）                                             | worker | B2   | PR 2 |
| B6  | web e2e 與整體驗收                                                   | 協調者 | 全部 | PR 2 |

## 驗收

- **A1**：`pnpm --filter @ledger/shared build` 通過；型別註解寫明誰會拿到值。
- **A2**：`debt-linking.e2e-spec.ts` 新增斷言：A 讀送出的連動邀請帶 `counterpartyId`、B 讀收到的為 `null`；B 讀收到的 `AMEND` 帶 `previous`（值為 B 那筆改之前的金額與日期），B 先刪掉自己那筆後為 `null`；其他種類為 `null`。隔離測試：第三人仍 `404`。既有 e2e 維持綠燈。
- **A3**：spec 與程式一致；PR 1 CI 全綠後合併。
- **B1**：hooks 測試驗證每支 API 的路徑、query、body；寫入後失效對象、往來紀錄、交易、帳戶、待確認。`TransactionsPage` 收到 `openCounterpartyId` 時打開往來帳，重新整理後不再打開。錯誤訊息表含 spec §4.7 全部代碼，且不含「好友」。
- **B2**：SC-W35、SC-W36 的元件測試；`excludeLinked` 只列 `link === null`；連動中的人選定後顯示「送出後會請 X 確認」；`debts.spec.ts` 的選人步驟改成新的下拉選單（協調者在 B6 跑）。
- **B3**：`CounterpartyDetail` 三種狀態（沒連動、邀請中、連動中）的按鈕與文字；邀請視窗的 email 送出、產生連結、複製、錯誤；同步標籤 3 種＋`NONE` 不顯示；`paired` 決定修改與刪除視窗是否有說明段；解除連動確認視窗文案；連動中沒有「刪除對象」（SC-W37、W43、W45、W46 的元件部分）。
- **B4**：每種句型各一個元件測試（含 `previous` 為 `null`）；一次只展開一筆（SC-W44）；接受新增提議送出的 `record`（物件或 `null`）；409 切換成「改成拒絕」（SC-W42）；沒有待確認時不渲染。
- **B5**：6 種狀態的元件測試；接受後網址不含 token、導到往來帳；程式裡沒有把 token 寫入 storage（SC-W39 的元件部分）。
- **B6**：`debt-linking.spec.ts` 跑 SC-W37～W45、W47；`debts.spec.ts` 維持綠燈；`grep -rn "好友" apps/web/src` 只出現在註解；完整 CI 綠（SC-W50）。
