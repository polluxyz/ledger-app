# Orca 多代理派工與交接

> 派工前先執行 `orca skills get orchestration`（或 `orca-cli`）取得版本相符的指令說明，**不要憑記憶下 flag**。本文件只寫這個專案的決定與踩過的限制。
>
> 本文的指令以 Orca 1.4.206 的 `skills get` 輸出核對過（2026-09-22）。

## 1. 角色分工

- **預設 agent 是 Claude Code**，它是 coordinator（協調者），負責拆工、派工、驗收、開 PR。
- **worker 優先用 Pi**（跑 GLM 模型）。GLM 額度用盡時改用 Claude Code 當 worker。
- **不要用 Claude Code 內建的 Agent tool 派工。** 它只開得了 Claude subagent，指定不了 Pi，也指定不了 GLM。要平行工作就走 `orca orchestration`。

什麼時候才需要協調者：使用者明確要求監督、追蹤完成、協調有相依的任務時。單純「把這件事交給另一個 agent，不監督」是交接，用 `orca-cli`，**不要建 Run**。

## 2. 派工迴圈

```bash
orca status --json
orca orchestration run-create --objective "<目標>" --json
orca orchestration worker-start --spec "<task spec>" --worktree current --agent pi --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

- **整個 run 用同一個執行檔。** 用哪個執行檔跑 `skills get`，就用哪個跑後續指令；它失敗就回報那個錯誤，不要換別的。
- 平行的工作**一次全部啟動再等**，不要開一個等一個。
- 收到 `worker_done` 後：先驗收，回覆 `reply`，再 `check --ack <delivery_id>`，最後 `worker-release`。驗收沒過不要 ack。
- `worker-start` 非 0 結束**不要重開**，讀 receipt 的 `failedStage` 與 `residualResources`。
- 連續三次空等就改用 `worker-list --include-remote --json` 列出實際狀態，依每列的 `projection.nextAction` 處理。**查不到不等於結束**，沒有正面證據就繼續等。

## 3. 模型分流

⚠️ **`worker-start --model` 只支援 Claude、Codex、Cursor 的模型 id，對 Pi 無效。**

Pi 的模型有兩條路：

1. 在 Orca 的 agent 設定裡指定 Pi 的預設模型（最省事，但全域一致）。
2. 自己開終端機再接上（`--model` 與 `--terminal` 不能並用）：

   ```bash
   pi --model zai/glm-5.3          # 預設
   pi --model zai/glm-5.3-flash    # 簡單任務
   ```

   然後 `worker-start --spec "..." --terminal <handle>`。
   **這條兩段式路徑尚未實測**，第一次用要確認 `terminal create` 回傳的 handle 吃得動。

分流準則：

| 模型                | 接什麼                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `zai/glm-5.3`       | 預設。一切需要判斷的工作                                         |
| `zai/glm-5.3-flash` | 只接**同時**滿足三條的任務：單一檔案、不需判斷、驗收條件機器可驗 |
| 一律不用 flash      | 寫測試、Prisma schema、API 介面、授權與資料隔離、寫 spec / plan  |

價差約 9 倍（`glm-5.3` 每 M token 輸入 1.4 / 輸出 4.4；`flash` 是 0.15 / 0.5），所以分流有意義。但**「這任務算不算簡單」由 coordinator 判斷**，不要讓 flash 自己認領。

測試不進便宜那一格的理由：測試是唯一會主動宣稱「這是對的」的程式碼，寫壞了會以綠燈的形式呈現。這個專案的授權與資料隔離測試是安全防線（見 `CLAUDE.md` §8、§9）。

## 4. 額度用盡時的切換

worker 回報 provider 額度或速率限制時：

1. **不要靜默重試**，也不要換個講法再問一次。
2. 用 `--retry-of <dispatch_id>` 搭配 `--task <task_id>` 重派同一個 Task，改成 `--agent claude --model <Opus 4.8 的 provider model id>`。`--retry-of` 不繼承 placement，要重新指定 worktree 與 agent。
3. **模型 id 先確認再填**，不要憑記憶寫。

這是暫時安排。之後有其他模型可用時回來改這一節。

## 5. Task spec 必須自足

**worker 不一定讀得到這個 repo 的 `CLAUDE.md`。** Pi 讀哪個指引檔尚未確認，所以任何 worker 需要遵守的規則，都要寫進 Task spec 本身。

官方要求的五欄：

- **Target**：範圍內的檔案、元件或環境。
- **Change**：要產出的具體結果。
- **Constraints**：不變量、相容性規則、不准碰的邊界。
- **Ownership**：這個 worker 可以改什麼、與其他 worker 的界線。
- **Observable acceptance**：證明完成的測試、輸出或證據。

`Constraints` 至少要抄進去的專案規則：

- 金額不可用浮點數。
- 授權 deny by default，查詢先以帳本權限過濾。
- 不在前端實作業務邏輯。
- **不准動 Prisma schema 與 API 介面**；需要動就回報，不要自己改。
- 註解用繁體中文。
- 完成前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。
- **不要跑 e2e**，除非 spec 指定由你跑。多個 worktree 共用 `ledger_test` 資料庫與固定 port。

涉及授權、資料隔離、Prisma schema、API 介面的工作**不派給 worker**，coordinator 自己做。

## 6. Session 交接（context 快滿時）

Orca 的 Run 是 daemon 端的持久狀態：Task、Dispatch、未 ack 的信都在裡面。所以交接**不是寫一份工作摘要**，是把 `run_id` 交出去，讓新 session 自己去讀。

**前提**：這一節只適用於有 Run 的監督式協調。純交接（不監督）用 `orca-cli`，不建 Run。

**舊 session（交接前）**

1. 把已經處理完的 Delivery `--ack` 掉，不要留半處理狀態。
2. 留一則交接信：
   `orca orchestration send --to run:<run_id> --subject "handoff" --body "<見下>" --json`
3. 把 `run_id` 交給使用者，然後**停手**。不要兩個 coordinator 同時在跑。

**新 session**

```bash
orca orchestration run-use     --id <run_id> --json    # 綁定
orca orchestration check       --json                  # 收交接信 + 未 ack 的批次重播
orca orchestration task-list   --run <run_id> --json   # 現況從這讀
orca orchestration worker-list --run <run_id> --json
```

**交接信只寫 Orca 查不到的東西**：決策與理由、試過但失敗的做法、使用者當場給的偏好或約束、沒寫進 Task spec 的前提。

**不要**重述 Task 內容、worker 狀態、改過的檔案——`task-list` / `worker-list` / `git diff` 都查得到。重述等於把舊 context 搬進新 session，交接就白做了。

**驗證綁定成功**（這一步不能省）：

- `run-use` 回應裡 `coordinator_handle` 要是你自己，`consumer_generation` 要 +1。
- `check` 回應裡**要有 `runId`**。沒有 `runId` 代表你根本沒綁上——那不是「信箱是空的」，Orca 不會給你明確的被踢掉訊號。

## 7. 已知限制

- **`orca` 不一定在 PATH 上。** 由 Orca 終端機啟動的 session 才有；從外面開的 session 要用 `%LOCALAPPDATA%/Programs/orca/resources/bin/orca.exe`。
- **Pi 沒有內建的 subagent 與 todo 工具。** 多代理協調靠 Orca 提供，不是 Pi 自己有。
- **Pi 讀哪個指引檔未確認。** 在確認之前，一律假設 worker 沒讀過 `CLAUDE.md`（見 §5）。
- **兩段式指定模型未實測**（見 §3）。
