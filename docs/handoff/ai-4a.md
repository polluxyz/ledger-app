# ai-4a 交接

## 現況與下一步

1. Haiku 的格式修正已合併。SC-P51、SC-P52 共 74/74 筆通過。[格式修正 PR #244](https://github.com/polluxyz/ledger-app/pull/244) · [實測紀錄](../../tasks/archive/ai-haiku-plan.md#7-實作紀錄)
2. 主工作區已切換 Haiku。第 81 次在 3200 暫時服務驗證通過，累計 81/100 次。計畫與任務清單已封存。[任務清單](../../tasks/archive/ai-haiku-todo.md)
3. 語音第 1～4 版已部署。`voice-acceptance` 已掛在本線，保有待填驗收表。沿用 `ctx_6c473e9890b7` 回報通道，主區接回本次結果，ai-4a 負責本線後續驗收。約到現場時重查。與開發者約桌機 Chrome 現場驗收，記錄 T3 後完成 T4。手機虛擬鍵盤與 AI 欄位的位置另待實機確認。[語音任務](../../tasks/ai-voice-todo.md)
4. 語音收尾後再開[匯入規劃](../operations/import-planning.md)。

## 操作限制

- De-identify cloud resources, requests, logs and reports. Explain to the developer before creating resources or increasing permissions.
- 11-28 後若新模型不可用，依[規格決策 405](../specs/phase-4a-ai-haiku.md)關閉 AI 解析。
- Reassess tail latency and privacy before opening to external users. 舊模型的驗收數字、已知問題與本機工具位置見[歷史交接](https://github.com/polluxyz/ledger-app/blob/d190f4fd76c6f261e0bd84ff68d43eb46b2c4f25/docs/handoff/ai-4a.md)。
