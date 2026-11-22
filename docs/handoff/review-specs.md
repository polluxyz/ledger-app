# review-specs 交接

R6 已合併並部署 dev。登出後使用舊憑證，dev 回應 401。[部署紀錄 #229](https://github.com/polluxyz/ledger-app/pull/229)

R5 已選自管 Linux。兩位 advisor 各完成 2 輪審閱。規劃者等待開發者確認主機與預算、可接受的資料缺口與復原時間、外部告警，再撰寫規格。假設清單 v2 已回報至 `run_39bcfae7f8b8` 的 `ctx_1cf49c673b35`。[審查報告](../reports/2026-11-11-project-review.md)

借還補驗由本線追蹤，`debt-f12-close` 是專用 worker 工作區。補驗已合併，worker 對話已釋放。F12 待開發者現場驗收，誤建成員清理另待授權。有結果時重查工作區與本機驗收資料。[補驗紀錄](../../tasks/phase-3f-plan.md#2026-11-21-f12-補驗)

## 2026-11-22 每週補查

審查線協調者保留 `review-specs` 與直屬的 `debt-f12-close`。R5 派工 `ctx_1cf49c673b35` 尚無完成回報。收到上述 3 項回答時重查。舊 F12 聊天的保留原因待確認，協調者下次週查核對。

借還派工 `ctx_ef4d1992db6b` 已回報成功，對話已釋放。獨有提交 `54f62e2` 列於已合併的 [#246](https://github.com/polluxyz/ledger-app/pull/246)，3 項檢查通過。子區仍有本機驗收成果。F12 現場驗收或開發者授權處理誤建成員時，由審查線協調者重查。

## 操作限制

- R5 保留的編號見[交接入口](../handoff.md)。 Start only after approval of the spec, then the plan and task list.
- Run this workspace’s two e2e suites separately. Both use `ledger_review_test`.
- For local Web unit tests use `pnpm --filter @ledger/web exec vitest run --maxWorkers=6`. 預設並行數曾使不同測試逾時。[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/review-specs.md)
