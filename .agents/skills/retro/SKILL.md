---
name: retro
description: '回顧指定開發 session 的紀錄，提出改善 agent 文件、工具與自動檢查的候選項目。'
license: MIT
metadata:
  source: 'mattpocock/skills@5beb35b040e3de97e54fa9e386d7e42d15c295c2'
---

# 開發流程復盤

改寫自 Matt Pocock 1.3.1 的 [retro](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/engineering/retro/SKILL.md) 與 [writing-for-agents](https://github.com/mattpocock/skills/blob/5beb35b040e3de97e54fa9e386d7e42d15c295c2/skills/productivity/writing-for-agents/SKILL.md)。授權見 [MIT notice](../LICENSE.mattpocock.txt)。

由使用者啟動，預設回顧目前 session；指定子階段（如 `3l`）或 session 時以該範圍為準。提出能改善下次工作的候選，預設完成於報告，不自動修改規則、程式或排程。使用者已明確授權套用的具體項目，才進入修正工作。

## 從實際紀錄找問題

讀指定範圍的對話、工具結果、驗收輸出、相關 commit，以及 repo 現有的規範與檢查設定。本機 session 紀錄：

- **Claude Code**：`~/.claude/projects/` 下名稱含 `ledger-app` 的目錄（主工作區 `d--Projects-ledger-app` 與各 Orca worktree）。
- **Codex**：一般殼層與桌面版在 `~/.codex/sessions/`；Orca 派的 worker 用 Orca 管理的帳號，紀錄在 `%APPDATA%/Orca/codex-accounts/<帳號>/home/sessions/`。

Claude Code 的用量與逐次 context 用 Pollux 的量測腳本，不要直接讀整份 JSONL：

```bash
uv run --directory D:/Projects/pollux python -X utf8 scripts/session_usage.py --match ledger-app [--session <id>]
```

`--session <id>` 逐次列出單一 session。腳本只讀本機檔案。報表的 `>210,000` 是 Pollux 自己的門檻，不是本專案的目標。若需要 Orca 的歷史搜尋，先用 `orca skills get orca-cli` 取得指南並確認搜尋索引可用；讀不到紀錄就說明限制，以手上證據完成可做的分析。

檢查有實際跡象的地方：

- **找資料**：同一個資訊是否反覆搜尋，或找錯位置？考慮增加明確指出何時讀哪份文件的指引。
- **工具成本與資訊缺口**：是否反覆讀過大輸出、重試相同失敗，或缺少必要 log／權限？引用實際呼叫與結果；沒有用量資料就不宣稱省了多少 token。
- **規則文件**：指令是否過期、互相衝突、重複，或藏在不會被讀取的位置？依實際行為判斷，不能只因文件長就刪規則。Claude Code 的記憶（`~/.claude/projects/D--Projects-ledger-app/memory/`）也算：長期有效、卻只寫在記憶裡的規則，worker 讀不到，列為回寫 repo 文件的候選。
- **錯誤的長期防護**：先讀既有 ESLint、型別檢查、測試、`.github/workflows/` 的 CI 與 hook，確認缺少的檢查是否其實已存在但沒有接好。

## 選擇改善方式

可以確定判斷的錯誤，優先用專案現有工具的規則、測試或 CI 擋下；需要跨檔案理解與取捨的判斷，才寫進相應規範。新增檢查要指出會擋住哪個已觀察到的錯誤。修改 CI 與新增相依套件屬於 `CLAUDE.md` §14 的 Ask first。hook 在 repo 之外（`~/.claude/settings.json`、`~/.orca/`），建置與測試不可依賴它。

文件保持單一權威來源：在現有文件改正，其他地方只放何時讀它的連結；按需要拆出參考資料。先明確描述期望行為與可檢查的完成條件。保留仍承載需求、取捨或限制的內容。

## 回報候選

按影響列出少量有證據的候選。每項包含：

1. 實際發生的問題，以及 session 片段、工具結果或檔案行號。
2. 建議改哪份文件／設定／檢查，改動內容與預期行為。
3. 代價或可能影響，如何驗證有改善，以及如何回復。

將已觀察到的事實與推測分開。沒有值得改的項目就明說，不為湊數提出新規則。需要持久保存且使用者有要求時，寫進 `docs/reports/` 並更新 `docs/README.md` 的報告表；核可後的決策回寫 [專案決策脈絡.md](../../../專案決策脈絡.md)，執行紀錄放對應 plan，長期有效的坑寫進 `CLAUDE.md` 或 `docs/orca-multi-agent.md`。

完成條件：每項建議都有來源、具體改動與驗證方式；未取得的紀錄與不能下的結論已清楚交代。
