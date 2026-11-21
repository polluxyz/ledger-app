# ai-4a 交接

## 現況與下一步

1. Haiku 的格式修正已通過實測。SC-P51、SC-P52 共 74/74 筆，累計模型呼叫 80/100 次。[格式修正 PR #244](https://github.com/polluxyz/ledger-app/pull/244) · [實測紀錄](../../tasks/ai-haiku-plan.md#7-實作紀錄)
2. 主工作區待切換 dev。依規格改 `LLM_PROVIDER` 與 `VERTEX_MODEL`，重開 API，再送 1 句確認。切換期限是 2026-11-28。[部署規格 §8](../specs/phase-4a-ai-haiku.md#8-部署)
3. 語音第 1～4 版已部署。與開發者約桌機 Chrome 現場驗收，記錄 T3 後完成 T4。手機虛擬鍵盤與 AI 欄位的位置另待實機確認。[語音任務](../../tasks/ai-voice-todo.md)
4. 語音收尾後再開[匯入規劃](../operations/import-planning.md)。

## 操作限制

- De-identify cloud resources, requests, logs and reports. Explain to the developer before creating resources or increasing permissions.
- 11-28 後若新模型不可用，依[規格決策 405](../specs/phase-4a-ai-haiku.md)關閉 AI 解析。
- Reassess tail latency and privacy before opening to external users. 舊模型的驗收數字、已知問題與本機工具位置見[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/ai-4a.md)。
