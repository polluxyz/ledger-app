# Orca 多代理派工與交接

> 派工前先執行 `orca skills get orchestration`（或 `orca-cli`）取得版本相符的指令說明，**不要憑記憶下 flag**。本文件只寫這個專案的決定與踩過的限制。
>
> 本文的指令以 Orca 1.4.206 的 `skills get` 輸出核對過（2026-09-22）。

## 1. 角色分工

- **預設 agent 是 Claude Code**，它是 coordinator（協調者），負責拆工、派工、驗收、開 PR。**它的主要工作是規劃與驗收，不是實作。**
- **實作預設派給 worker**，優先用 Pi（跑 GLM 模型）。額度用盡就往下換層：Antigravity → Claude Code（見 §4）。
- **不要用 Claude Code 內建的 Agent tool 派工。** 它只開得了 Claude subagent，指定不了 Pi，也指定不了 GLM。要平行工作就走 `orca orchestration`。

協調者該做與不該做：

| 協調者自己做                                   | 派給 worker                                        |
| ---------------------------------------------- | -------------------------------------------------- |
| 寫 spec 與 plan、拆任務、做決策                | 依 spec 實作功能                                   |
| 驗收 worker 的產出、開 PR、盯 CI               | 寫該功能的單元測試（用 `zai/glm-5.3`，不用 flash） |
| 授權與資料隔離相關的程式碼                     | 前端頁面與元件                                     |
| Prisma schema、API 介面                        | 重構、補文件、修 lint                              |
| 派工成本高於自己做的瑣碎改動（改一個字串之類） | —                                                  |

「派工成本高於自己做」是唯一的模糊地帶。判準：如果寫 Task spec 的時間比自己改還久，就自己改。

什麼時候才需要協調者：使用者明確要求監督、追蹤完成、協調有相依的任務時。單純「把這件事交給另一個 agent，不監督」是交接，用 `orca-cli`，**不要建 Run**。

## 2. 派工迴圈

```bash
orca status --json
orca orchestration run-create --objective "<目標>" --json
orca orchestration worker-start --spec "<task spec>" --worktree current --agent pi --json
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

⚠️ **協調者必須是綁定該 Run 的終端機。** 從 Orca 終端機以外呼叫 `worker-start` 會被拒絕：`worker-start requires the coordinator terminal currently bound to the Task Run`。解法是先拿 handle 再用 `--from`：

```bash
orca orchestration run-current --json        # 取 coordinator_handle
orca orchestration worker-start --from <coordinator_handle> ... --json
orca orchestration check       --terminal <coordinator_handle> --wait ... --json
```

旗標名稱三個指令各不相同：`worker-start` 用 `--from`，`check` 用 `--terminal`，`worker-release` **兩個都不吃**（傳了會回 `Unknown flag`）。在 Orca 自己的終端機裡全部可以省略。

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
   # 模型寫在 pi 自己的旗標上：zai/glm-5.3 或 zai/glm-5.3-flash
   orca terminal create --worktree <selector> --command "pi --model zai/glm-5.3-flash" --json
   orca orchestration worker-start --spec "<task spec>" --terminal <handle> --json
   ```

   **已端對端實測**（2026-09-22，見 §8）。用 `--terminal` 時終端機是自己開的，Orca 不擁有它，所以 `worker-list --terminal-state reclaimable` 會是空的；`worker-release` 仍然要呼叫，它會回 ok。

分流準則：

| 模型                | 接什麼                                                           |
| ------------------- | ---------------------------------------------------------------- |
| `zai/glm-5.3`       | 預設。一切需要判斷的工作                                         |
| `zai/glm-5.3-flash` | 只接**同時**滿足三條的任務：單一檔案、不需判斷、驗收條件機器可驗 |
| 一律不用 flash      | 寫測試、Prisma schema、API 介面、授權與資料隔離、寫 spec / plan  |

價差約 9 倍（`glm-5.3` 每 M token 輸入 1.4 / 輸出 4.4；`flash` 是 0.15 / 0.5），所以分流有意義。但**「這任務算不算簡單」由 coordinator 判斷**，不要讓 flash 自己認領。

測試不進便宜那一格的理由：測試是唯一會主動宣稱「這是對的」的程式碼，寫壞了會以綠燈的形式呈現。這個專案的授權與資料隔離測試是安全防線（見 `CLAUDE.md` §8、§9）。

## 4. 額度用盡時的切換

### 怎麼判斷額度真的用完了

⚠️ **`pi auth check` 判斷不出來。** 實測 `pi auth check --provider zai --json` 只回 `{"status":"ready","provider":"zai","authType":"api_key"}`——它驗的是憑證有沒有效，不看用量。額度用完它一樣說 ready。

**唯一可靠的訊號是 worker 帶回來的錯誤原文**，所以每個 Task spec 都要寫這條：

> 遇到 provider 錯誤時，用 escalation 或 `worker_done --outcome failed` 把**錯誤訊息原文**帶回來。不要自己重試，不要換個說法再問一次，不要只寫「失敗」。

協調者收到之後依訊息內容分流：

| 錯誤訊息講什麼                              | 判定       | 做什麼                                   |
| ------------------------------------------- | ---------- | ---------------------------------------- |
| rate limit、too many requests、請稍後再試   | 暫時性     | 同一個模型 `--retry-of` 重派一次，並報告 |
| quota、insufficient balance、用量／方案額度 | 真的用完   | 換下一層                                 |
| 看不出來                                    | 先當暫時性 | 重派一次；同樣錯誤再出現就換層           |

「重派一次」不違反「不要靜默重試」——差別在於它是**講出來的一次**，不是默默試到通。

### 備援順序

| 層  | agent                | 模型                                                        | 什麼時候       |
| --- | -------------------- | ----------------------------------------------------------- | -------------- |
| 1   | Pi                   | `zai/glm-5.3`（簡單任務 `zai/glm-5.3-flash`）               | 預設           |
| 2   | Antigravity（`agy`） | `gemini-3.1-pro-high`（簡單任務 `gemini-3.8-flash-medium`） | GLM 額度用完   |
| 3   | Claude Code          | `opus`                                                      | 前兩層都不能用 |

換層時用 `--retry-of <dispatch_id>` 搭配 `--task <task_id>` 重派同一個 Task。`--retry-of` 不繼承 placement，要重新指定 worktree 與 agent。

### 第 2 層：Antigravity

跟 Pi 一樣要兩段式（Orca 的 `--model` 只認 Claude / Codex / Cursor）：

```bash
orca terminal create --worktree <selector> --command "agy --model gemini-3.1-pro-high" --json
orca orchestration worker-start --spec "<task spec>" --terminal <handle> --json
```

- **努力程度寫在模型 id 裡**（`-high` / `-medium` / `-low`），不要再另外傳 `--effort`。
- `agy models` 列出當下可用的模型，換模型前先跑一次，**不要憑記憶填**。它除了 Gemini 也有 `claude-sonnet-4-6`、`gpt-oss-120b-medium`。
- ⚠️ **未實測**：`agy` 當 worker 時會不會卡在權限確認。它有 `--dangerously-skip-permissions`，但那會自動核准所有工具請求——只在拋棄式 worktree 裡用，而且 Task spec 要把不准碰的東西寫清楚。

### 第 3 層：Claude Code

不需要兩段式：`worker-start --model` 本來就支援 Claude 的 model id，一行就能指定 `--agent claude --model opus`。

| 要什麼              | 填什麼                                            |
| ------------------- | ------------------------------------------------- |
| 最新的 Opus（建議） | `opus`                                            |
| 釘住 Opus 4.8       | `claude-opus-4-8`                                 |
| 搭配 1M context     | 後綴 `[1m]`，如 `opus[1m]`、`claude-opus-4-8[1m]` |

**建議用 `opus` 別名，不要釘版本。** 別名解析為帳號上最新的 Opus；這台機器的 `/model` 選擇器顯示的是 Opus 5，比 4.8 新。釘死版本只在「新版行為有問題、要退回去」時才需要。

完整 id 一定要寫對：Claude Code 在 Anthropic API 上會驗證模型名稱，不認得的字串會被拒絕並顯示 `Model "<name>" is not a recognized model id.`。它接受別名、選擇器裡的項目，以及任何 `claude-` 開頭的名稱。

`--effort` 要搭配 `--model` 一起給，兩者都不能與 `--terminal` 並用。

三層的順序是成本與可用性的取捨，不是品質排名。有新模型可用時回來改這一節。

## 5. Task spec 必須自足

**Pi worker 會讀 `CLAUDE.md`。** 2026-09-22 實測：在這個 repo 啟動 Pi，畫面的 `[Context]` 區塊就列出 `CLAUDE.md`，skills 也一併載入。

⚠️ **不要在 repo 裡新增 `AGENTS.md`。** Pi 每個目錄只取第一個命中的指引檔，順序是 `AGENTS.override.md` → `AGENTS.md` → `AGENTS.MD` → `CLAUDE.md` → `CLAUDE.MD`。建了 `AGENTS.md` 會**蓋掉同目錄的 `CLAUDE.md`**，而不是補充它。

即使如此，**Task spec 仍然必須自足**——這是 Orca 的硬性要求，而且 worker 只會拿到你寫的那段文字當工作內容。分界是：通用規則靠 `CLAUDE.md`，這個任務特有的邊界寫進 spec。

官方要求的五欄：

- **Target**：範圍內的檔案、元件或環境。
- **Change**：要產出的具體結果。
- **Constraints**：不變量、相容性規則、不准碰的邊界。
- **Ownership**：這個 worker 可以改什麼、與其他 worker 的界線。
- **Observable acceptance**：證明完成的測試、輸出或證據。

`Constraints` 每次都要寫的四條（`CLAUDE.md` 沒有，或 worker 容易誤判）：

- **不准動 Prisma schema 與 API 介面**；需要動就回報，不要自己改。
- **不要跑 e2e**，除非 spec 指定由你跑。多個 worktree 共用 `ledger_test` 資料庫與固定 port。
- 完成前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。
- **遇到 provider 錯誤時把錯誤原文帶回來**，不要自己重試，也不要只寫「失敗」（理由見 §4）。

其餘規則（金額不用浮點數、授權 deny by default、不在前端寫業務邏輯、註解用繁體中文）`CLAUDE.md` 已經有，不必重抄。

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

## 8. 實測紀錄（2026-09-22）

開一個拋棄式 worktree，派一個唯讀任務給 Pi，全程走完再刪掉。結果：

| 驗證項目                           | 結果                                                                                                       |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `.worktreeinclude`                 | **有效**。`apps/api/.env`、`.env.test`、`.claude/settings.local.json` 都被複製過去                         |
| 新 worktree 的 `node_modules`      | 不存在，符合預期。要自己跑 `pnpm install`                                                                  |
| 兩段式指定模型                     | **有效**。worker 自己回報「running on model id `glm-5.3-flash`（provider `zai`，讀 `PI_MODEL` 環境變數）」 |
| `worker-start --terminal <handle>` | **有效**，但要加 `--from <coordinator_handle>`（見 §2）                                                    |
| 完整生命週期                       | `run-create` → `worker-start` → `check --wait` → `worker-release` → `check --ack` 全部成功                 |

順帶記下 Orca 的命名慣例：worktree 建在 `C:/Users/<使用者>/orca/workspaces/<repo>/<name>`，分支名是 `<github 帳號>/<name>`。
