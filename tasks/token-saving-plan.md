# 節省 Claude Code token：從 Pollux 移植

來源：Pollux 的 `tasks/token-saving-ledger-port.md`（移植清單 L1～L5）與 `tasks/token-saving-plan.md`（量測定義、做法、實測）。只改 agent 讀的文件與 Claude Code 設定，不動產品程式、DB、API、CI。

## 1. 基準（2026-10-22 量）

`uv run --directory D:/Projects/pollux python -X utf8 scripts/session_usage.py --match ledger-app`（腳本留在 Pollux，不複製；量測定義見 Pollux plan §2）

| 範圍     | session | request | 平均 context | p95     | 最大    | 超過 21 萬 | 壓縮 |
| -------- | ------- | ------- | ------------ | ------- | ------- | ---------- | ---- |
| 全部     | 53      | 8,600   | 324,710      | 751,630 | 963,967 | 5,335      | 30   |
| 10-15 起 | 10      | 2,117   | 240,664      | 425,848 | 753,901 | 1,125      | 22   |

- 10-15 起，`web-redesign/bf02c5c5` 一個 session 占快取讀取 40.4%，壓縮 14 次。原因和 Pollux 一樣：協調者的長 session。
- 新 session 第一輪約 54,000～57,000 token。

## 2. 項目與決定

| #   | 項目                                                                                                  | 決定                                                                                                                   | 回復                     |
| --- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| L1  | `.claude/settings.local.json` 加 `syncClaudeAiSkills`、`disableClaudeAiConnectors`、`disableArtifact` | 做。HTML 只產在本機 `docs/artifacts/`（`CLAUDE.md` §13），用不到 claude.ai Artifact 與 Office／PDF skill               | 刪掉三個鍵，開新 session |
| L2  | `.claude/settings.json`：`autoCompactWindow` 150000 ＋ SessionStart `compact` hook                    | 做，壓縮值維持 150K（開發者 10-22）。hook 改單引號（Prettier）；在 main 上列出所有 open PR，因為總控在 main 管平行分支 | 只刪 `autoCompactWindow` |
| L3  | 一件事完成就換 session（`docs/orca-multi-agent.md` §6.3）                                             | 做。handoff 依工作區拆檔、併進最後一個 PR（見 §3）                                                                     | revert 該 PR             |
| L4  | `CLAUDE.md` 瘦身：規則不刪，細節移到唯一權威文件                                                      | 做，排最後                                                                                                             | revert 該 PR             |
| L5  | 觀察 7 天                                                                                             | 從 L2 在所有 Claude 協調者 worktree 生效起算                                                                           | —                        |

不搬：擋下裸 `python` 的 hook（ledger-app 是 Node 專案）。

## 3. 開發者 10-22 的回答

- 順序 L1 → L2 → L3 → L4 核可。
- 壓縮值維持 150K。
- handoff 不再單獨開 PR，有變動就併進該工作最後一個 PR。
- 總控不是不能傳訊息給其他 session，而是不要每個工作都互相匯報。這次的改動由總控直接讓其他 session 換新 session。
- handoff 依工作區拆檔：不同工作區的內容不同，共用一份反而讓每個 session 多讀別人的內容。（推翻 Pollux 清單「handoff 拆檔不用搬」的判斷。）
- 沒在用的 worktree 一律清掉。

## 4. 成功條件

- L2：新 session 的 `/context` 顯示「Auto-compact window: 150k」。
- L3：實際換一次 session，新 session 讀入口與自己的 handoff 檔後，說對 worktree、分支、下一步。
- L5：生效後 7 天，平均 context、p95、超過 21 萬的次數與 §1 比較；樣本至少 5 個有實質工作的 session、100 次 request，不足就延長。同時看總快取讀取，避免用多開短 session 把平均做得好看。

## 5. 實作紀錄

### L1（10-22）

- 寫入主工作區、`ai-4a`、`stats-2j`、`ledger-split-web` 的 `.claude/settings.local.json`，保留原本的 `permissions` 與 `outputStyle`。`.worktreeinclude` 已列這個檔，新 worktree 會從主工作區複製。
- 寫入後，當下的 session 立刻失去 claude.ai 連接器與 Artifact 工具，和 Pollux 觀察一致。

### 清理 worktree（10-22）

- 移除 `backend`（detached `d29d454`）、`web-redesign`（detached `912e0d9`）：工作區沒有未提交的改動，HEAD 都已在 main 裡。`orca worktree rm` 留下 `node_modules` 等殘檔，另外刪掉。
- 保留 `ledger-split-web`：分支 `docs/agent-workflow-skills`，10-22 還有寫入，另一個 session 在用。
- 測試資料庫 `ledger_backend_test` 已沒有 worktree 使用，刪除被權限擋下，待開發者處理。

### L2（#144，`294b0ba`）

- 手動執行 hook：主工作區與 `stats-2j` 都 exit 0，印出正確的分支與 HEAD。當時沒有 open PR，`gh pr list --state open --json number,headRefName,title` 回傳空陣列，欄位名稱正確。
- 待確認：新 session 的 `/context` 顯示「Auto-compact window: 150k」。`stats-2j`、`ai-4a` 要併入含 #144 的 main 才會生效。

### L3（#145，`1ef0022`）

- `docs/orca-multi-agent.md` 新增 §6.3，§6 標題、§6.1、§6.2 同步修改；`CLAUDE.md` §11 加入口。
- handoff 拆成入口 `docs/handoff.md`（工作區表格、跨工作區規則、開發者偏好）與 `docs/handoff/main.md`、`stats-2j.md`、`ai-4a.md`。內容原文搬移；部署步驟只有主工作區會用，放在 `main.md`。
- 其他 session：2j、4a 的 session 還沒開過（兩個 worktree 沒有任何 Claude 或 Codex 的對話紀錄），開了就直接照新結構。關掉兩個閒置的終端機：舊總控 5298c2d0（工作已在 #143 交接，停在 resume 畫面）、做完 #142 的 Codex。通知 skills 移植 session（`ledger-split-web`）：目前的 PR 合併後照 §6.3 收尾。
- 待確認：實際換一次 session（§4 成功條件）。

### L4

- `CLAUDE.md` 11,419 → 10,487 字元。規則一條都沒刪：
  - §11 worktree 規則的原因與細節（`postinstall`、`.worktreeinclude` 清單、e2e 資料庫與 port、Orca hook／skill 位置）→ `docs/orca-multi-agent.md` §7.1。
  - §12 重新索引指令、`--repo-path` 陷阱、已知限制 → `docs/README.md`「程式碼檢索」。
  - §11 額度查詢的指令名稱拿掉（§4 已有）；§13 入口縮短。
- 避開 `docs/agent-workflow-skills` 分支正在改的 §5、§10，減少合併衝突。
