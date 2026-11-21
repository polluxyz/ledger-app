# ai-4a 交接

## 現況與下一步

1. Haiku 的程式已合併。T2 紀錄在本區的 `docs/ai-haiku-t3` 分支，提交 `6a926c5`。保留這筆提交供後續整合。[程式 PR #230](https://github.com/polluxyz/ledger-app/pull/230)
2. T3 等開發者核對 Google Cloud 的請求與回應記錄、組織政策，或授權唯讀查詢。依計畫驗 SC-P51、SC-P52，通過後才由 main 切換 dev。切換期限為 2026-11-28。[Haiku 計畫 §1.4](../../tasks/ai-haiku-plan.md)
3. 語音第 1～4 版已部署。與開發者約桌機 Chrome 現場驗收，記錄 T3 後完成 T4。手機虛擬鍵盤與 AI 欄位的位置另待實機確認。[語音任務](../../tasks/ai-voice-todo.md)
4. 語音收尾後再開[匯入規劃](../operations/import-planning.md)。

## 操作限制

- De-identify cloud resources, requests, logs and reports. Explain to the developer before creating resources or increasing permissions.
- 11-28 後若新模型不可用，依[規格決策 405](../specs/phase-4a-ai-haiku.md)關閉 AI 解析。
- Reassess tail latency and privacy before opening to external users. 舊模型的驗收數字、已知問題與本機工具位置見[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/ai-4a.md)。
