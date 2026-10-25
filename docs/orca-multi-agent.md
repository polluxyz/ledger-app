# Orca 多代理派工與交接

派工前先執行 `orca skills get orchestration` 取得版本相符的指令說明，不要憑記憶下 flag。本文件只寫這個專案的決定與踩過的坑。指令以 Orca 1.4.218 核對過（2026-10-03）。

## 0. 角色表（換模型只改這裡）

其他文件、`CLAUDE.md`、Task spec 一律只寫**角色名**，不寫模型 id。換模型時改這張表，再依「啟動方式」那一欄派工。

| 角色           | 什麼時候用                                                      | 啟動方式                                                                                                              |
| -------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `default`      | 一般實作：前端、測試、重構、補文件、單純的 API 端點             | 兩段式，`--command "codex --dangerously-bypass-approvals-and-sandbox -m gpt-6-luna -c model_reasoning_effort=max"`    |
| `backend`      | 難或要求高準確的：migration SQL、授權與隔離、鎖、金額與帳戶規則 | 一行，`--agent codex --model gpt-6.1-sol --effort high`                                                               |
| `fallback-1`   | `default` 額度用完                                              | 兩段式，`--command "pi --model zai/glm-5.3"`；單檔、不需判斷、機器可驗的任務改 `zai/glm-5.3-flash`                    |
| `fallback-2`   | `fallback-1` 也用完                                             | 一行，`--agent antigravity --model gemini-3.8-flash-high`                                                             |
| `fallback-3`   | 前三層都不能用                                                  | 一行，`--agent claude --model claude-sonnet-5-5 --effort high`                                                        |
| `advisor`      | 要開發者拍板的決策，先聽第二意見（見 §1.1）                     | 兩段式，`--command "codex --dangerously-bypass-approvals-and-sandbox -m gpt-6.1-sol -c model_reasoning_effort=xhigh"` |
| `advisor` 備援 | `advisor` 額度用完                                              | 一行，`--agent antigravity --model gemini-4-argon-high`，不帶 `--effort`（強度寫在模型 id 裡）                        |

順序由開發者定案（2026-09-24 Codex → GLM → Gemini，09-26 加 `backend`，09-29 確認 Codex 優先，10-04 把 `backend` 限縮到難或要求高準確的工作）。順序是成本與可用性的取捨，不是品質排名。強度也是開發者定的取捨：`gpt-6-luna` 用 max，sol 用 high（2026-10-03；2026-10-14 起 `backend` 換成 `gpt-6.1-sol`），Claude worker 用 Sonnet 5.5 high（2026-10-04），不要自己調高或調低。`advisor` 先問 Codex `gpt-6.1-sol` xhigh，用完改 Gemini 4 Argon high（2026-10-22；10-18 原本是 Argon 優先）。兩個都用完就不往下換。

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
- 換模型前先查可用清單，不要憑記憶填：Codex 看 Orca 帳號目錄裡的 `models_cache.json`（見 §5 Codex，不是 `~/.codex`），Pi 跑 `pi --list-models`，agy 跑 `agy models`。Claude 的模型 id 是 `claude-<家族>-<版本>`，例如 `claude-sonnet-5-5`。
- 2026-10-03 實測過一行派 Codex（`gpt-6-luna xhigh`），`launch.effective` 相符，worker 回報是 full access、沒有許可提示。`fallback-2` 的一行寫法還沒實測。失敗的話改用兩段式。

## 1. 分工

- Claude Code 是 coordinator（協調者），負責規劃、拆工、派工、驗收、開 PR。實作預設派給 worker，能平行的一次全部派出去。
- 協調者自己做的只有三種：`packages/shared` 的型別契約、授權與資料隔離的測試（先寫、先看到紅燈）、寫 Task spec 比自己改還久的瑣碎改動。
- 網頁（`apps/web`）的設計與實作都由 Codex（`default` 的 Codex 那一層）全權負責（開發者 2026-10-21 定實作、10-24 擴大到設計）。
  - 設計：版面、樣式、方案比較、`docs/artifacts/` 的預覽頁都派 Codex 做。協調者可以看設計，但只提建議，不自己出設計稿或改預覽頁。
  - 實作：協調者連小修也不自己做，驗收不過就退回 Codex。
  - Codex 用完時網頁任務不換層，見 §4「派工前檢查」。
- 動到 schema、API、授權的產出，不管哪個角色做，協調者驗收時都要逐行看 diff（授權條件、交易邊界、migration SQL），並自己重跑隔離測試與兩套 e2e。
- 派工走 `orca orchestration`，不要用 Claude Code 內建的 Agent tool。它只開得了 Claude，指定不了其他 agent。
- 不需要監督的單純交接用 `orca-cli`，不要建 Run。

### 1.1 徵詢 `advisor`（第二意見）

要請開發者拍板的事（Ask first 事項、決策卡、偏離 spec、方案取捨、spec 的假設清單），先問 `advisor`，再一起報告。開發者 2026-10-22 決定照 Pollux 的做法，而且先問 Codex（§0）。

1. 依 §0 的 `advisor` 列，在協調者自己的 worktree（`--worktree path:<協調者的 worktree>`）派工：Codex 先開兩段式終端機再接上，Argon 用一行 `worker-start`。沒有進行中的 run 就先 `run-create`。Codex 用完與否照 §4 判定；判定用完就 `worker-stop`、`orca terminal close`，用 `--retry-of` 改派 Argon。
2. 徵詢 spec 寫：背景（相關 spec、plan 的路徑與已知事實）、要決定的問題、目前想到的方案。**不寫自己傾向哪一個**，避免它順著答。要它回：推薦哪個與理由、每個方案的壞處、有沒有漏掉的方案或風險。
3. Constraints 換成這幾條：唯讀，不改檔、不 commit；不跑 DB 測試、e2e 與 `prisma migrate`；回覆用繁體中文，以 `worker_done` 帶回。
4. 收到回覆後確認 `git status` 乾淨，再 `worker-release`；兩段式再 `orca terminal close`。
5. 雙方意見不同時，互相交流直到定案，不設輪數上限（2026-10-24 開發者要求照 Pollux 2026-10-23 的改法：「當與advisor有意見分歧時 需要互相交流直到定案」）。
   - 每輪只送還分歧的點：自己的反駁、根據的程式或資料、對方上一輪的論點哪裡不成立。已一致的點不重送。
   - 協調者被說服就改採對方意見；對方被說服就照新共識寫。兩種都算定案。
   - 某一輪雙方都沒有新論據或新證據，只是重複前一輪的理由，就算「保留分歧」定案，交給開發者拍板。
   - `advisor` 額度用完時照 §0 換層；都用完就停在當下，報告時註明交流沒有完成。
6. 報告時並列：`advisor` 的建議、自己的建議、一致與分歧之處，以及最後建議。決定仍由開發者核可。

例外：

- 只是請開發者提供資訊或執行指令（貼輸出、確認畫面）不用徵詢。
- Codex 與 Argon 都用完：不往下換，直接問開發者，報告時註明這次沒問到。

## 2. 派工迴圈

使用者要求完成整份已核可的 spec 時，讀 [`implement-spec`](../.agents/skills/implement-spec/SKILL.md)：以任務依賴持續續派，在整合分支驗收。該流程沿用本文件的角色、資源限制與恢復規則。

```bash
orca orchestration run-create --objective "<目標>" --json
orca orchestration worker-start ...                      # 見 §0
orca orchestration check --wait --types "worker_done,escalation,question" --timeout-ms 300000 --json
```

- 不在 Orca 終端機裡時，`worker-start` 會被拒絕（`requires the coordinator terminal currently bound to the Task Run`）。用 `run-current --json` 取 `coordinator_handle`，再傳給 `worker-start --from` 與 `check --terminal`。`worker-release` 兩個旗標都不收。
- 整個 run 用同一個 `orca` 執行檔。它失敗就回報那個錯誤，不要換執行檔。
- 收到 `worker_done` 的順序：驗收 → `reply` → `check --ack <delivery_id>` → `worker-release`。驗收沒過不要 ack。
- `worker-start` 非 0 結束不要重開，先讀 receipt 的 `failedStage` 與 `residualResources`。
- 每次 `check` 逾時（5 分鐘），對每個還沒回報的 worker 做 §4 的「執行中檢查」。逾時不要設長，額度用完的 worker 不會自己回報。
- 連續三次空等，改用 `worker-list --include-remote --json`，依每列的 `projection.nextAction` 處理。查不到不等於結束。

## 3. Task spec

worker 只拿得到你寫的 Task spec，所以 spec 要自足。五欄：**Target**（範圍內的檔案）、**Change**（要產出的結果）、**Constraints**（不准碰的邊界）、**Ownership**（可以改什麼、與其他 worker 的界線）、**Observable acceptance**（證明完成的測試或輸出，寫成可逐項打勾的清單）。

Constraints 每次都寫這六條：

- 不准動 Prisma schema 與 API 介面，需要動就回報（Task spec 明確指派的除外）。
- 不要跑 e2e，除非 spec 指定。預設多個 worktree 共用 `ledger_test` 資料庫與固定 port（例外見下一條之後的說明）。
- Prisma 的 `migrate`／`db` 指令只能對 `.env.test` 的資料庫跑。`.worktreeinclude` 會把指向開發者 `ledger_dev` 的 `apps/api/.env` 複製進 worktree，3c 與 3e 的 migration 都曾因此在合併前被套用到 dev 資料庫。

協調者在派工前做兩件事，不靠 worker 記得：

1. 會碰 Prisma 的 worker，它 worktree 裡的 `apps/api/.env` 與 `apps/api/.env.test` 都改成指向它專屬的測試資料庫（`ledger_<名稱>_test`，先 `create database`）。名稱一定要以 `_test` 結尾：Web e2e 的 global setup 只肯清空這種資料庫，`ledger_test_<名稱>` 會被拒絕（3e 畫面踩過）。這樣 worker 弄錯環境變數也碰不到 `ledger_dev`。
2. API e2e 用 supertest 在行程內跑、不佔 port，所以各用各的資料庫就能同時跑。Web 的 Playwright 仍然一次只能一個。

- 只對自己的 Target 檔案跑 `pnpm exec prettier --write <檔案>`，不要跑根目錄的 `pnpm format`。平行時會改到別人的檔案。
- 完成前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。
- 遇到 provider 錯誤時，把錯誤訊息原文用 escalation 或 `worker_done --outcome failed` 帶回來。不要自己重試，也不要只寫「失敗」。（額度完全用完時 worker 發不出回報，所以協調者還要自己查，見 §4。）

依 agent 再加：

- **Codex**：開頭寫「先讀根目錄與對應 app 的 `CLAUDE.md`」。Codex 預設只讀 `AGENTS.md`，而這個 repo 刻意不建 `AGENTS.md`，因為 Pi 遇到 `AGENTS.md` 就不讀同目錄的 `CLAUDE.md`。本機的 Codex 設定（`~/.codex` 與 Orca 各帳號目錄的 `config.toml`）已加上 `project_doc_fallback_filenames = ["CLAUDE.md"]`（2026-10-21），新 session 會自動載入根目錄的 `CLAUDE.md`。開頭那句仍要寫：worker 從 worktree 根目錄啟動，`apps/api`、`apps/web` 的 `CLAUDE.md` 不會自動載入。Orca 新增 Codex 帳號時，要在新帳號目錄的 `config.toml` 補這一行。
- **Claude**：加一句「清單還有未完成項目、又沒有東西擋住你時，不要用摘要結束回合，直接做下一項」。Claude 做長任務時，可能報完進度就停下，`worker_done` 也沒送出。

通用規則（金額不用浮點數、授權 deny by default、前端不寫業務邏輯、註解用繁體中文）已寫在 `CLAUDE.md`，不必重抄。

## 4. 額度用盡、自動換層、自動回復

額度用完的 worker 叫不動模型，也就發不出 escalation。所以不能等 worker 回報，要由協調者主動查。訊號有兩個：

- **用量 API**：`orca account list --json` 的 `result.rateLimits`。Codex（`codex`）與 Claude（`claude`）有 `session`（5 小時視窗）與 `weekly` 的 `usedPercent` 與 `resetsAt`。GLM 與 Gemini 目前查不到（`status: "unavailable"`）。
- **worker 畫面**：`orca terminal read --terminal <handle> --screen`。找 quota、usage limit、rate limit、insufficient balance、Eligibility check failed 這類字樣。

`pi auth check` 只驗憑證，額度用完一樣回 ready，不能當訊號。

### 判定「用完」

任一條成立就當作這個 provider 用完：

- `rateLimits` 的 `session` 或 `weekly` 的 `usedPercent` ≥ 95。Codex 不用這條，見下一段。
- worker 畫面或回報出現額度類錯誤。
- worker 閒置（`orca terminal wait --for tui-idle` 立刻返回）、沒有 `worker_done`，畫面最後一段是 provider 錯誤。

Codex 用到沒有為止（開發者 2026-10-19）：`usedPercent` 只當參考，不提早換層。等 worker 畫面或回報真的出現額度類錯誤，才判定 Codex 用完。

畫面只寫 rate limit、too many requests、請稍後再試，而且用量沒到 95：當作暫時性，同一個角色重派一次並報告。

### 派工前檢查

每次 `worker-start` 前跑一次 `orca account list --json`，從角色表最上面的可用層開始：

- `default`：Codex 沒用完就派 Codex，用完就往下找第一個沒用完的 `fallback`。網頁任務例外：Codex 用完就停下來告訴開發者，等 Codex 重置，不派給其他層。
- `backend`：Codex 沒用完就派。用完的話，看 `resetsAt`：一小時內會重置就等重置再派，否則問開發者。這類工作不派給其他層。
- `advisor`：Codex 沒用完就派 Codex；用完派 Argon。Argon 也用完就不徵詢，報告時註明。Argon 查不到用量，被判定用完後的回復照「自動回復」的 5 小時規則。
- `fallback-3`（Claude）和協調者共用同一個 Claude 額度。`claude` 的 `session` 超過 80 就不派，避免協調者自己被卡住。

### 執行中檢查

每次 `check --wait` 逾時，對每個還沒回報的 worker：

1. 跑 `orca account list --json`，看它的 provider 有沒有用完。
2. 讀它的畫面，看有沒有額度類錯誤。
3. 判定用完：`worker-stop`（兩段式再 `orca terminal close`），用 `--retry-of <dispatch_id> --task <task_id>` 換下一層重派，並在訊息裡告訴開發者換到哪一層。不用等開發者同意。`--retry-of` 不繼承 placement，worktree 與 agent 要重新指定。

### 自動回復

換層只對那一次派工有效，不是永久切換。

- 下一次派工前照樣做「派工前檢查」。上層的 `usedPercent` 降回 95 以下，或已經過了記下的 `resetsAt`，就回到原本的層。Codex 只看是否已過 `resetsAt`。
- 查不到用量的層（GLM、Gemini）被判定用完時，記下時間。過 5 小時後的派工，先試它一次。
- 已經在下層執行中的 worker 讓它做完，不要因為上層恢復就中途換回去。
- 回到原本的層時，也告訴開發者一聲。

## 5. 各 agent 的坑

**通用**

- 自己開的終端機（兩段式）裡，`worker-stop` 關不掉程序，要再跑 `orca terminal close`。`worker-list --terminal-state reclaimable` 也會是空的，但 `worker-release` 仍要呼叫。
- 派工後讀一次畫面。看到 `[Pasted Content N chars]` 代表任務只貼進輸入框、沒有送出，補一次 `orca terminal send --terminal <handle> --enter`。
- worker 回報「全部通過」不算數，驗收時自己跑 `pnpm typecheck` 與 `pnpm test`。agy 曾回報全綠，實際有型別錯誤與逾時的測試。
- 跳過許可的代價是 worker 在 worktree 裡做什麼都不會問。驗收時看完整的 `git status` 與 `git diff`，範圍外的改動一律退回。
- 用 `--terminal` 接到不在協調者 worktree 的終端機，要同時帶 `--worktree path:<那個 worktree>`，否則回 `terminal_worktree_mismatch`。
- Orca 自動更新或重啟後，舊的終端機 handle 會回 `terminal_handle_stale`，用 `orca terminal list` 依標題找新 handle。重啟前開的兩段式終端機可能派工逾時（`agent_readiness` timeout），或 Codex 每個指令都失敗（`helper_unknown_error: setup refresh had errors`）。遇到就 `worker-stop`、`orca terminal close`，開新終端機用 `--retry-of` 重派（2026-10-25）。

**Codex**

- 第一次在某個 repo 啟動會問「信任這個資料夾」，有新版時會問「是否更新」（選 3「Skip until next version」）。答完要關掉終端機重開，否則 Orca 會一直判定卡住（`codex-trust-workspace`、`codex-update-prompt`）。
- Orca 派的 Codex 用 Orca 管理的帳號（`orca account list` 的 `codex.activeAccountId`），不是系統預設的 `~/.codex`。協調者在自己的終端機直接跑 `codex` 用的是後者，2026-10-14 那是免費帳號，`gpt-6-sol` 會回「not supported when using Codex with a ChatGPT account」，`~/.codex/models_cache.json` 也沒有 sol。要手動測模型，設 `CODEX_HOME` 指向 Orca 的帳號目錄（`%APPDATA%/Orca/codex-accounts/<activeAccountId>/home`），或直接派一個 worker 看 `launch.effective`。

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

- 不要在 spec 寫「想清楚再做」，也不要要求它把推理寫進回覆。思考量只用 `--effort` 調。依據：[Prompting Claude Opus 5.5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5)。
- 它停在半途、沒送 `worker_done` 時，用 `orca terminal send` 點名還沒做的項目請它繼續。同一個任務最多催 2～3 次，之後讀畫面判斷是不是真的卡住。

## 6. Session 交接（一件事完成或 context 過大時）

什麼時候換見 6.3；換的程序是 6.0～6.2。

### 6.0 一次只留一個活著的 session

新 session 接手後，舊 session 的終端機要關掉。兩個 agent 留在同一個 worktree，使用者對著舊分頁打字，就會變成兩個 agent 改同一批檔案。

舊 session 不要自己關自己，因為指令送出的瞬間對話就結束，使用者拿不到說明。收尾步驟：

1. 交接完成後立刻停手，不要再改檔案。
2. 報告新 session 的 handle、自己的 handle、關閉指令 `orca terminal close --terminal <舊 handle>`。
3. 由使用者關掉舊分頁。使用者明說「你自己關」才自己執行，而且先說明執行後不會再有回覆。

自己的 handle：`run-current --json` 的 `coordinator_handle`，或 `orca terminal list --json` 裡對到自己的那一列。

### 6.1 舊 session

1. 更新自己工作區的 `docs/handoff/<工作區>.md` 與入口 `docs/handoff.md` 表格中的那一列（只寫現況、下一步、開發者當場給的偏好、已知問題）。有變動才改，併進這件工作最後一個 PR；沒有 PR 可併時才單獨開 docs PR。
2. 有 Run 時：把處理完的 Delivery `--ack` 掉，再留交接信 `orca orchestration send --to run:<run_id> --subject "handoff" --body "..." --json`，最後把 `run_id` 交給使用者。
3. 依 6.0 收尾。

交接信只寫 Orca 查不到的東西：決策與理由、試過但失敗的做法、使用者當場給的偏好、沒寫進 Task spec 的前提。Task 內容、worker 狀態、改過的檔案都查得到，不要重述。

### 6.2 新 session

用 `claude --dangerously-skip-permissions` 開，第一件事讀 `docs/handoff.md` 與自己工作區的檔案，其他工作區的檔案不讀。有 Run 時：

```bash
orca orchestration run-use     --id <run_id> --json
orca orchestration check       --json
orca orchestration task-list   --run <run_id> --json
orca orchestration worker-list --run <run_id> --json
```

確認綁定成功：`run-use` 的 `coordinator_handle` 要是自己、`consumer_generation` 要加 1；`check` 的回應要有 `runId`。沒有 `runId` 代表沒綁上，不是信箱空了。

### 6.3 一件事完成就換 session

長 session 每輪都重送整段對話，是 token 的最大宗（`tasks/token-saving-plan.md` §1：10-15 起平均 context 24 萬，一個長 session 占快取讀取 40%）。所以協調者做完一件事就主動換 session，不等 context 滿。

**觸發**：目前核可的一個完整工作單位做完，例如整個階段、或開發者交代的一項修正都已合併。不是任一 PR 合併就換；交接本身的 PR 不算。

**共同門檻**，全部成立才換：

- 沒有進行中的 worker、待處理的 Delivery 或問題、驗收或背景作業（`run_in_background` 也算）。
- 開發者已送出的要求都處理完。
- 沒有只存在對話裡、還沒寫下的操作狀態（部署做到第幾步、開發者貼回的輸出等）。

**context 過大**：超過約 12～13 萬 token（試行值；`.claude/settings.json` 在 15 萬自動壓縮）時，先把重點寫進 plan 與 handoff，到下一個符合共同門檻的時間點再換。不要為了換 session 丟下進行中的 Run。

**步驟**：

1. 依 6.1 更新 handoff，停止寫入。
2. 開新終端機，只啟動 agent，提示不放進 `--command`（中文與多層引號在 Windows 上容易被拆壞）。用和自己同一種 agent，Claude 是：
   `orca terminal create --worktree path:<目前的 worktree> --title "<工作區> 接手" --command "claude --dangerously-skip-permissions" --json`
3. `orca terminal wait --terminal <新 handle> --for tui-idle --timeout-ms 120000 --json`，確認 satisfied。
4. `orca terminal send --terminal <新 handle> --text "讀 docs/handoff.md 與 docs/handoff/<工作區>.md，接手<工作區>。先唯讀確認 worktree、分支、HEAD 與下一步、待核可事項，回報後等開發者指示。" --enter --wait-submit 30 --json`。逾時就讀同一個 handle 的畫面，不要重開或重送。
5. 讀新 session 的畫面，確認它開始讀 handoff，而且沒有以 resume 接上舊對話。有 Run 時，新 session 依 6.2 綁定。
6. 依 6.0 收尾：報告新舊 handle 與 `orca terminal close --terminal <舊 handle>`，由開發者關舊分頁。

開發者關掉舊分頁之前，兩個 session 都還活著，「只剩一個 agent」靠的是舊 session 停手的約定，不是技術保證。新 session 沒有新的核可工作時，只確認接手並等待，不自己開始下一段。

換 session 是各工作區自己的事，不用向總控匯報；總控讀 git 掌握進度。

## 7. 環境

- `orca` 不一定在 PATH 上。從 Orca 以外開的 session 用 `%LOCALAPPDATA%/Programs/orca/resources/bin/orca.exe`。
- Orca 重開後，舊的 `check --wait` 可能留下 `waiter_exists`，一直回空結果。改用 `worker-list` 的 `projection.outcome` 輪詢，或等舊 waiter 逾時。
- 新 worktree 建在 `C:/Users/<使用者>/orca/workspaces/<repo>/<name>`，分支名是 `<github 帳號>/<name>`。`.worktreeinclude` 列的檔案會被複製過去，`node_modules` 不會，要自己跑 `pnpm install`。

### 7.1 worktree 規則的細節（`CLAUDE.md` §11）

worktree 是硬碟上獨立的一份簽出，與主工作區共用同一個 `.git`，但工作目錄的檔案是各自的實體副本。

- `pnpm install` 會連帶執行 `postinstall: prisma generate`，把 Prisma Client 產到該 worktree 自己的 `node_modules`。不同分支的 lock 檔與 Prisma schema 可能不同，所以不能跨 worktree 共用 `node_modules`。
- `.worktreeinclude` 目前列 `apps/api/.env`、`apps/api/.env.test`、`.claude/settings.local.json`。
- 兩套 e2e 共用 `ledger_test` 資料庫，每個測試前都清空，同時跑會互相洗掉資料。port 也是固定的（dev：API 3000 / Vite 5173；e2e：3100 / 5273），會撞。API e2e 不佔 port，worktree 的 `.env.test` 改指向自己的資料庫就能平行（見 §3）。
- Orca 的 hook 在 `~/.claude/settings.json` 與 `~/.orca/`，skill 在 `~/.agents/skills/`，都在 repo 之外，CI 用不到。可用的 skill：`orca-cli`（worktree、終端機、內建瀏覽器）、`orchestration`（多 agent 協調）、`orca-per-workspace-env`（容器 / VM 環境配方，目前用不到）。
