# Orca 多代理派工與交接

> 派工前先執行 `orca skills get orchestration`（或 `orca-cli`）取得版本相符的指令說明，**不要憑記憶下 flag**。本文件只寫這個專案的決定與踩過的限制。
>
> 本文的指令以 Orca 1.4.206 的 `skills get` 輸出核對過（2026-09-22）。

## 1. 角色分工

- **預設 agent 是 Claude Code**，它是 coordinator（協調者），負責拆工、派工、驗收、開 PR。**它的主要工作是規劃與驗收，不是實作。**
- **實作預設派給 worker**，優先用 Codex（`gpt-6-luna`，推理強度 max）。額度用盡就往下換層：Pi（GLM）→ Antigravity（Gemini）→ Claude Code（見 §4）。
- **不要用 Claude Code 內建的 Agent tool 派工。** 它只開得了 Claude subagent，指定不了 Codex、Pi，也指定不了 GLM。要平行工作就走 `orca orchestration`。

協調者該做與不該做：

| 協調者自己做                                   | 派給 worker                                        |
| ---------------------------------------------- | -------------------------------------------------- |
| 寫 spec 與 plan、拆任務、做決策                | 依 spec 實作功能                                   |
| 驗收 worker 的產出、開 PR、盯 CI               | 寫該功能的單元測試（用 `zai/glm-5.3`，不用 flash） |
| `packages/shared` 的型別契約                   | 前端頁面與元件                                     |
| 授權與資料隔離的測試（先寫、先紅燈）           | Prisma schema、migration、API、授權邏輯（見下）    |
| —                                              | 重構、補文件、修 lint                              |
| 派工成本高於自己做的瑣碎改動（改一個字串之類） | —                                                  |

**複雜的後端工作一律派 Codex + `gpt-6-sol`（推理強度 `xhigh`）**（開發者 2026-09-26 定案），不派給其他層。協調者的把關：先寫好 shared 契約與隔離測試；驗收時逐行看 diff（授權條件、交易邊界、migration SQL），自己重跑隔離測試與兩套 e2e。

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

| 層  | agent                | 模型                                          | 什麼時候       |
| --- | -------------------- | --------------------------------------------- | -------------- |
| 1   | Codex                | `gpt-6-luna`，推理強度 `max`（不分任務難度）  | 預設           |
| 2   | Pi                   | `zai/glm-5.3`（簡單任務 `zai/glm-5.3-flash`） | Codex 額度用完 |
| 3   | Antigravity（`agy`） | `gemini-3.8-flash-high`（不分任務難度）       | GLM 額度也用完 |
| 4   | Claude Code          | `opus`                                        | 前三層都不能用 |

順序由開發者 2026-09-24 定案（Codex → GLM → Gemini）。

換層時用 `--retry-of <dispatch_id>` 搭配 `--task <task_id>` 重派同一個 Task。`--retry-of` 不繼承 placement，要重新指定 worktree 與 agent。

### 第 1 層：Codex

一律用兩段式，因為要帶 `--dangerously-bypass-approvals-and-sandbox`（開發者 2026-09-24 定案；`worker-start --agent codex --model` 帶不了這個旗標）：

```bash
orca terminal create --worktree <selector> --command "codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -c model_reasoning_effort=max" --json
orca orchestration worker-start --spec "<task spec>" --terminal <handle> --json
```

複雜的後端工作（§1）把模型換成 `-m gpt-6-sol -c model_reasoning_effort=xhigh`，其餘相同。

- 模型 id 與推理強度以本機 `~/.codex/models_cache.json` 為準（2026-09-24 查過：Codex CLI 0.155.1，`gpt-6-luna` 支援 low / medium / high / xhigh / max）。換模型前先查這個檔，**不要憑記憶填**。
- `-c model_reasoning_effort=max`：`-c` 的值先當 TOML 解析，失敗就當字串，所以 `max` 不必加引號。
- 旗標會跳過所有許可確認與沙箱，和 Antigravity 的 `--dangerously-skip-permissions` 同一類，代價與對策也相同：Task spec 寫清楚邊界，驗收看完整的 `git status` 與 `git diff`。
- ⚠️ **Codex 讀的指引檔是 `AGENTS.md`，不是 `CLAUDE.md`**。這個 repo 刻意沒有 `AGENTS.md`（會蓋掉 Pi 讀的 `CLAUDE.md`，見 §5），所以派給 Codex 的 Task spec 開頭一定要寫「先讀根目錄與對應 app 的 `CLAUDE.md`」。
- **實測（2026-09-24，3b-1 往來帳版的 W-A、W-B）**：兩個 worker 平行，產出品質好，回報與協調者重跑的結果一致。踩到的坑：
  1. 第一次在某個 repo 啟動會問「信任這個資料夾」（信任範圍是 repo 根目錄）；有新版時會問「是否更新」。答完（更新選 3「Skip until next version」，不替開發者更新全域套件）都要**關掉終端機重開**，否則提示文字留在歷史裡，Orca 會誤判卡住（`codex-trust-workspace`、`codex-update-prompt`）。
  2. `worker-start --terminal` 有時只把任務貼進輸入框、沒有送出（畫面顯示 `[Pasted Content N chars]`）。派工後讀一次畫面，看到這行就補送 `orca terminal send --terminal <handle> --enter`。
  3. Task spec 若叫它跑根目錄 `pnpm format`，平行時會改到別的 worker 的檔案。改成只對自己的 Target 檔案跑 `pnpm exec prettier --write <檔案>`。

### 第 3 層：Antigravity

跟 Pi 一樣要兩段式（Orca 的 `--model` 只認 Claude / Codex / Cursor）：

```bash
orca terminal create --worktree <selector> --command "agy --model gemini-3.8-flash-high --dangerously-skip-permissions" --json
orca orchestration worker-start --spec "<task spec>" --terminal <handle> --json
```

- **一律加 `--dangerously-skip-permissions`**（開發者 2026-09-24 定案）。不加的話，agy 每個指令、每次改檔、每次建檔都要人回答，worker 會停著等（見下面的實測）。代價是 worker 在 worktree 裡的所有動作都不再詢問，所以兩件事不能省：Task spec 的 Constraints 與 Ownership 要把不准碰的檔案與指令寫清楚；驗收時協調者要看過完整的 `git status` 與 `git diff`，範圍外的改動一律退回。
- **這一層不分任務難度，一律 `gemini-3.8-flash-high`。** 第 2 層（Pi）才有便宜 / 一般的分流。
- **努力程度寫在模型 id 裡**（`-high` / `-medium` / `-low`），不要再另外傳 `--effort`。
- §3「一律不用 flash」指的是 `zai/glm-5.3-flash` 這個成本層級，**跟 Gemini 模型名稱裡的 flash 無關**。Gemini 3.8 Flash 比清單上的 3.1 Pro 新一代，不是弱化版。
- `agy models` 列出當下可用的模型，換模型前先跑一次，**不要憑記憶填**。它除了 Gemini 也有 `claude-sonnet-4-6`、`gpt-oss-120b-medium`。
- **實測（2026-09-24，3b-1 Web 的 B3、B4，當時沒加 `--dangerously-skip-permissions`）**：`agy` 當 worker 會卡在權限確認，而且有三種提示——執行指令（`Run this command?`）、修改檔案（`Accept this file edit?`）、建立檔案（`Allow creation of this file?`）。**每一個都要有人回答**，否則 worker 就停著。
  - 這次的做法：協調者用 `orca terminal read --screen` 盯畫面，指令只放行白名單（`orca orchestration`、`pnpm lint/typecheck/test/format`、`git` 唯讀、讀檔搜尋），改檔與建檔只放行該 Task 的 Target 檔案，其餘停下來由協調者判斷；回答用 `orca terminal send --text "1"`。
  - 這個做法可行但操作成本高（B4 一個任務約 30 次許可），所以之後一律改用 `--dangerously-skip-permissions`。
- **啟動的兩個坑**，解法都是「關掉那個終端機，重開一個新的」：
  1. 第一次在某個資料夾啟動會問「信任這個資料夾嗎」。答完之後，提示文字仍留在終端機歷史裡，Orca 會一直判定 `agent-trust-workspace` 而擋下 `worker-start`（`Agent startup blocked`）。信任設定已經存起來了，新終端機不會再問。
  2. 啟動當下若 Google 的登入驗證剛好回 503，整個 session 會一直回 `Eligibility check failed: UNAVAILABLE (code 503)`，之後服務恢復也一樣。log 在 `~/.gemini/antigravity-cli/log/`，找 `Validation failed`。
- `worker-start --terminal <agy 的 handle>` 第一次呼叫有時回 `agent_unconfigured`，同一個指令再呼叫一次就成功。原因未查明。
- ⚠️ agy worker 回報的「全部通過」不可盡信：B4 回報全綠，實際有 1 個型別錯誤與 1 條逾時的測試。驗收時一定自己跑 `pnpm typecheck` 與 `pnpm test`。

### 第 4 層：Claude Code

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

涉及授權、資料隔離、Prisma schema、API 介面的工作**只派給 Codex `gpt-6-sol` xhigh**（§1）；shared 契約與隔離測試由 coordinator 先寫。

## 6. Session 交接（context 快滿時）

### 6.0 開了新的，舊的就要丟掉（兩種交接都適用）

**一次交接只能留下一個活著的 session。** 新 session 接手之後，舊 session 的終端機要關掉。

為什麼：兩個 agent 留在**同一個 worktree** 時，使用者哪天對著舊分頁打字，就會變成兩個
agent 同時改同一批檔案。兩邊都不知道對方存在，衝突要等 `git status` 才看得出來。

⚠️ **舊 session 不要自己關自己。** 指令送出的瞬間對話就結束了，使用者只會看到分頁消失、
拿不到任何說明。正確的收尾是：

1. 交接信送出、確認 `accepted: true` 之後，**立刻停手**，不要再改任何檔案。
2. 報告三件事：新 session 的終端機 handle、自己的 handle、以及關閉指令：
   ```bash
   orca terminal close --terminal <舊 session 的 handle>
   ```
3. 由**使用者**關掉舊分頁。使用者明說「你自己關」時才自己執行，而且那是最後一個動作——
   執行後不會再有回覆，這件事要先講。

自己的 handle 哪裡來：`orca orchestration run-current --json` 的 `coordinator_handle`，
或 `orca terminal list --json` 裡對到自己那一列。

> 2026-09-23 補上這一節。當天交接後舊 session 沒有收掉，兩個 Claude 同時留在
> `D:\Projects\ledger-app`，是使用者發現的。

---

Orca 的 Run 是 daemon 端的持久狀態：Task、Dispatch、未 ack 的信都在裡面。所以交接**不是寫一份工作摘要**，是把 `run_id` 交出去，讓新 session 自己去讀。

**前提**：6.1 與 6.2 只適用於有 Run 的監督式協調。純交接（不監督）用 `orca-cli`，不建 Run。
**但 6.0 兩種都適用**——不管有沒有 Run，舊的都要收掉。

### 6.1 舊 session（交接前）

0. **先更新 `docs/handoff.md`**（只寫重點：現況、下一步、開發者當場給的偏好、已知問題），開 PR 合併。新 session 一律用 `claude --dangerously-skip-permissions` 開，第一件事讀它。沒有 Run 的純交接也照做。

1. 把已經處理完的 Delivery `--ack` 掉，不要留半處理狀態。
2. 留一則交接信：
   `orca orchestration send --to run:<run_id> --subject "handoff" --body "<見下>" --json`
3. 把 `run_id` 交給使用者，然後**停手**。不要兩個 coordinator 同時在跑。
4. 依 6.0 報告自己的 handle 與關閉指令，等使用者收掉這個分頁。

### 6.2 新 session

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
