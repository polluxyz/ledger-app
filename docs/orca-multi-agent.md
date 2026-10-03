# Orca 多代理派工與交接

派工前先執行 `orca skills get orchestration` 取得版本相符的指令說明，不要憑記憶下 flag。本文件只寫這個專案的決定與踩過的坑。指令以 Orca 1.4.218 核對過（2026-10-03）。

## 0. 角色表（換模型只改這裡）

其他文件、`CLAUDE.md`、Task spec 一律只寫**角色名**，不寫模型 id。換模型時改這張表，再依「啟動方式」那一欄派工。

| 角色         | 什麼時候用                                         | 啟動方式                                                                                                           |
| ------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `default`    | 一般實作：前端、測試、重構、補文件                 | 兩段式，`--command "codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -c model_reasoning_effort=max"` |
| `backend`    | Prisma schema、migration、API 介面、授權與資料隔離 | 一行，`--agent codex --model gpt-6-sol --effort xhigh`                                                             |
| `fallback-1` | `default` 額度用完                                 | 兩段式，`--command "pi --model zai/glm-5.3"`；單檔、不需判斷、機器可驗的任務改 `zai/glm-5.3-flash`                 |
| `fallback-2` | `fallback-1` 也用完                                | 一行，`--agent antigravity --model gemini-3.8-flash-high`                                                          |
| `fallback-3` | 前三層都不能用                                     | 一行，`--agent claude --model opus --effort medium`                                                                |

順序由開發者定案（2026-09-24 Codex → GLM → Gemini，09-26 加 `backend`，09-29 確認 Codex 優先）。順序是成本與可用性的取捨，不是品質排名。

兩種啟動方式：

```bash
# 一行
orca orchestration worker-start --spec "<task spec>" --worktree <selector> --agent <agent> --model <id> [--effort <level>] --json

# 兩段式：自己開終端機，再把 worker 接上去
orca terminal create --worktree <selector> --command "<表上的指令>" --json
orca orchestration worker-start --spec "<task spec>" --terminal <handle> --json
```

- **一行能用就用一行。** 回應裡的 `launch.effective` 會寫出實際的模型與強度，以它為準，不要只看自己傳了什麼。
- 只有兩種情況要兩段式：
  1. Orca 不支援這個 agent 的 `--model`。Pi 屬於這種。
  2. Orca 不接受這個強度。Orca 1.4.218 對 `gpt-6-luna` 拒絕 `--effort max`（`does not support effort max`），但 Codex 本身支援。改成 `xhigh` 就能用一行。
- 一行派工不用自己帶跳過許可的旗標。Orca 設定的 `agentDefaultArgs` 已經替 codex 與 antigravity 加上。兩段式是自己開終端機，旗標要寫在 `--command` 裡，表上的指令已經寫好。
- 換模型前先查可用清單，不要憑記憶填：Codex 看 `~/.codex/models_cache.json`，Pi 跑 `pi --list-models`，agy 跑 `agy models`。Claude 用 `opus` 別名就會自動跟到最新版。
- `backend` 的 Codex 額度用完時，不要往下換層，先問開發者。
- 2026-10-03 實測過一行派 Codex（`gpt-6-luna xhigh`），`launch.effective` 相符，worker 回報是 full access、沒有許可提示。`fallback-2` 的一行寫法還沒實測。失敗的話改用兩段式。

## 1. 分工

- Claude Code 是 coordinator（協調者），負責規劃、拆工、派工、驗收、開 PR。實作預設派給 worker，能平行的一次全部派出去。
- 協調者自己做的只有三種：`packages/shared` 的型別契約、授權與資料隔離的測試（先寫、先看到紅燈）、寫 Task spec 比自己改還久的瑣碎改動。
- `backend` 角色的工作，協調者驗收時要逐行看 diff（授權條件、交易邊界、migration SQL），並自己重跑隔離測試與兩套 e2e。
- 派工走 `orca orchestration`，不要用 Claude Code 內建的 Agent tool。它只開得了 Claude，指定不了其他 agent。
- 不需要監督的單純交接用 `orca-cli`，不要建 Run。

## 2. 派工迴圈

```bash
orca orchestration run-create --objective "<目標>" --json
orca orchestration worker-start ...                      # 見 §0
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 900000 --json
```

- 不在 Orca 終端機裡時，`worker-start` 會被拒絕（`requires the coordinator terminal currently bound to the Task Run`）。用 `run-current --json` 取 `coordinator_handle`，再傳給 `worker-start --from` 與 `check --terminal`。`worker-release` 兩個旗標都不收。
- 整個 run 用同一個 `orca` 執行檔。它失敗就回報那個錯誤，不要換執行檔。
- 收到 `worker_done` 的順序：驗收 → `reply` → `check --ack <delivery_id>` → `worker-release`。驗收沒過不要 ack。
- `worker-start` 非 0 結束不要重開，先讀 receipt 的 `failedStage` 與 `residualResources`。
- 連續三次空等，改用 `worker-list --include-remote --json`，依每列的 `projection.nextAction` 處理。查不到不等於結束。

## 3. Task spec

worker 只拿得到你寫的 Task spec，所以 spec 要自足。五欄：**Target**（範圍內的檔案）、**Change**（要產出的結果）、**Constraints**（不准碰的邊界）、**Ownership**（可以改什麼、與其他 worker 的界線）、**Observable acceptance**（證明完成的測試或輸出，寫成可逐項打勾的清單）。

Constraints 每次都寫這六條：

- 不准動 Prisma schema 與 API 介面，需要動就回報（`backend` 任務除外）。
- 不要跑 e2e，除非 spec 指定。多個 worktree 共用 `ledger_test` 資料庫與固定 port。
- Prisma 的 `migrate`／`db` 指令只能對 `.env.test` 的資料庫跑。`.worktreeinclude` 會把指向開發者 `ledger_dev` 的 `apps/api/.env` 複製進 worktree，3c 的 migration 曾因此在合併前被套用到 dev 資料庫。
- 只對自己的 Target 檔案跑 `pnpm exec prettier --write <檔案>`，不要跑根目錄的 `pnpm format`。平行時會改到別人的檔案。
- 完成前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。
- 遇到 provider 錯誤時，把錯誤訊息原文用 escalation 或 `worker_done --outcome failed` 帶回來。不要自己重試，也不要只寫「失敗」。

依 agent 再加：

- **Codex**：開頭寫「先讀根目錄與對應 app 的 `CLAUDE.md`」。Codex 只讀 `AGENTS.md`，而這個 repo 刻意不建 `AGENTS.md`，因為 Pi 遇到 `AGENTS.md` 就不讀同目錄的 `CLAUDE.md`。
- **Claude（Opus 5.5）**：加一句「清單還有未完成項目、又沒有東西擋住你時，不要用摘要結束回合，直接做下一項」。Opus 5.5 做長任務時，可能報完進度就停下，`worker_done` 也沒送出。

通用規則（金額不用浮點數、授權 deny by default、前端不寫業務邏輯、註解用繁體中文）已寫在 `CLAUDE.md`，不必重抄。

## 4. 額度用盡與換層

額度有沒有用完，只看 worker 帶回的錯誤原文。`pi auth check` 只驗憑證，額度用完一樣回 ready。

| 錯誤訊息講什麼                              | 做什麼                                   |
| ------------------------------------------- | ---------------------------------------- |
| rate limit、too many requests、請稍後再試   | 暫時性。同一個角色 `--retry-of` 重派一次 |
| quota、insufficient balance、用量／方案額度 | 換 §0 的下一層                           |
| 看不出來                                    | 先重派一次；同樣錯誤再出現就換層         |

重派用 `--retry-of <dispatch_id> --task <task_id>`。`--retry-of` 不繼承 placement，worktree 與 agent 要重新指定。重派那一次要報告，不要默默試到通。

## 5. 各 agent 的坑

**通用**

- 自己開的終端機（兩段式）裡，`worker-stop` 關不掉程序，要再跑 `orca terminal close`。`worker-list --terminal-state reclaimable` 也會是空的，但 `worker-release` 仍要呼叫。
- 派工後讀一次畫面。看到 `[Pasted Content N chars]` 代表任務只貼進輸入框、沒有送出，補一次 `orca terminal send --terminal <handle> --enter`。
- worker 回報「全部通過」不算數，驗收時自己跑 `pnpm typecheck` 與 `pnpm test`。agy 曾回報全綠，實際有型別錯誤與逾時的測試。
- 跳過許可的代價是 worker 在 worktree 裡做什麼都不會問。驗收時看完整的 `git status` 與 `git diff`，範圍外的改動一律退回。

**Codex**

- 第一次在某個 repo 啟動會問「信任這個資料夾」，有新版時會問「是否更新」（選 3「Skip until next version」）。答完要關掉終端機重開，否則 Orca 會一直判定卡住（`codex-trust-workspace`、`codex-update-prompt`）。

**Pi**

- `worker-start --model` 對 Pi 無效，只能兩段式，模型寫在 `pi --model` 上。
- Pi 每個目錄只讀第一個命中的指引檔，順序是 `AGENTS.override.md` → `AGENTS.md` → `CLAUDE.md`。所以不要新增 `AGENTS.md`。
- `glm-5.3-flash` 便宜約 9 倍，但寫測試、Prisma、API、授權、spec / plan 一律不用它。測試寫壞了會以綠燈的形式出現。
- 「任務算不算簡單」由協調者判斷，不要讓 flash 自己認領。
- Pi 沒有內建的 subagent 與 todo 工具。

**Antigravity（agy）**

- 一定要跳過許可。不跳的話，每個指令、改檔、建檔都要人回答，worker 會停著等。
- 強度寫在模型 id 裡（`-high`／`-medium`／`-low`），不要另外傳 `--effort`。模型名的 flash 跟 Pi 的 flash 成本層級無關。
- 第一次在某個資料夾啟動會問信任，答完要關掉終端機重開，否則 Orca 判定 `agent-trust-workspace`。
- 啟動時 Google 驗證剛好回 503，整個 session 會一直回 `Eligibility check failed: UNAVAILABLE (code 503)`。關掉重開。log 在 `~/.gemini/antigravity-cli/log/`。
- `worker-start` 第一次有時回 `agent_unconfigured`，同一個指令再呼叫一次就成功。

**Claude Code**

- 用 `opus` 別名，不要釘版本（2026-10-03 解析為 Opus 5.5，固定版本是 `claude-opus-5-5`）。要 1M context 就加後綴 `opus[1m]`。
- effort 從 `medium` 開始。它是 Opus 5.5 的預設，寫程式的表現追平 Opus 5 的 `high`。`xhigh`／`max` 只用在比過、確定有提升的任務。想少思考就降 effort，不要在 spec 寫「想清楚再做」，也不要要求它把推理寫進回覆。依據：[Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)。
- 它停在半途、沒送 `worker_done` 時，用 `orca terminal send` 點名還沒做的項目請它繼續。同一個任務最多催 2～3 次，之後讀畫面判斷是不是真的卡住。

## 6. Session 交接（context 快滿時）

### 6.0 一次只留一個活著的 session

新 session 接手後，舊 session 的終端機要關掉。兩個 agent 留在同一個 worktree，使用者對著舊分頁打字，就會變成兩個 agent 改同一批檔案。

舊 session 不要自己關自己，因為指令送出的瞬間對話就結束，使用者拿不到說明。收尾步驟：

1. 交接完成後立刻停手，不要再改檔案。
2. 報告新 session 的 handle、自己的 handle、關閉指令 `orca terminal close --terminal <舊 handle>`。
3. 由使用者關掉舊分頁。使用者明說「你自己關」才自己執行，而且先說明執行後不會再有回覆。

自己的 handle：`run-current --json` 的 `coordinator_handle`，或 `orca terminal list --json` 裡對到自己的那一列。

### 6.1 舊 session

1. 更新 `docs/handoff.md`（只寫現況、下一步、開發者當場給的偏好、已知問題），開 PR 合併。沒有 Run 的純交接也要做。
2. 有 Run 時：把處理完的 Delivery `--ack` 掉，再留交接信 `orca orchestration send --to run:<run_id> --subject "handoff" --body "..." --json`，最後把 `run_id` 交給使用者。
3. 依 6.0 收尾。

交接信只寫 Orca 查不到的東西：決策與理由、試過但失敗的做法、使用者當場給的偏好、沒寫進 Task spec 的前提。Task 內容、worker 狀態、改過的檔案都查得到，不要重述。

### 6.2 新 session

用 `claude --dangerously-skip-permissions` 開，第一件事讀 `docs/handoff.md`。有 Run 時：

```bash
orca orchestration run-use     --id <run_id> --json
orca orchestration check       --json
orca orchestration task-list   --run <run_id> --json
orca orchestration worker-list --run <run_id> --json
```

確認綁定成功：`run-use` 的 `coordinator_handle` 要是自己、`consumer_generation` 要加 1；`check` 的回應要有 `runId`。沒有 `runId` 代表沒綁上，不是信箱空了。

## 7. 環境

- `orca` 不一定在 PATH 上。從 Orca 以外開的 session 用 `%LOCALAPPDATA%/Programs/orca/resources/bin/orca.exe`。
- Orca 重開後，舊的 `check --wait` 可能留下 `waiter_exists`，一直回空結果。改用 `worker-list` 的 `projection.outcome` 輪詢，或等舊 waiter 逾時。
- 新 worktree 建在 `C:/Users/<使用者>/orca/workspaces/<repo>/<name>`，分支名是 `<github 帳號>/<name>`。`.worktreeinclude` 列的檔案會被複製過去，`node_modules` 不會，要自己跑 `pnpm install`。
