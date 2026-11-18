# Orca 多代理派工與交接

派工前先執行 `orca skills get orchestration` 與 `orca skills get orca-cli`。需要任務圖、放置或恢復時，再讀當前版本的對應參考說明。下列指令與欄位以 Orca 1.4.261 核對。

## 0. 角色表（模型與強度的唯一來源）

其他文件、Task spec 和下方範例只寫角色名。啟動新聊天或 worker 時，把對應列的參數代入。既有聊天沿用原設定。

| 角色                             | 什麼時候用                                                     | 啟動參數                                                                                                        |
| -------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 主工作區協調者                   | `main` 的新聊天，統整工作區                                    | `--agent codex --model gpt-6.2-astra --effort high`                                                             |
| `planner`                        | 子工作區的新規劃，Codex 未達 §4 門檻                           | `--agent codex --model gpt-6.2-sol --effort xhigh`                                                              |
| `planner`（單次切換）            | 子工作區的新規劃，Codex 任一用量達 §4 門檻                     | `--agent claude --model claude-opus-5-5 --effort high`                                                          |
| `default`                        | 一般實作，含前端、測試、重構、文件及單純的 API 端點            | `--agent codex --model gpt-6.2-sol --effort medium`                                                             |
| `backend`                        | 高準確度實作，含 migration SQL、授權與隔離、鎖、金額及帳戶規則 | `--agent codex --model gpt-6.2-sol --effort medium`                                                             |
| `fallback-1`                     | `default` 額度用完，且任務可換層                               | `--agent pi --model zai/glm-5.3`。單檔、無須判斷且可由機器驗證的任務可用 `--agent pi --model zai/glm-5.3-flash` |
| `fallback-2`                     | `fallback-1` 也用完                                            | `--agent antigravity --model gemini-3.8-flash-high`                                                             |
| `fallback-3`                     | 前三層都不能用                                                 | `--agent claude --model claude-sonnet-5-5 --effort high`                                                        |
| `advisor`（第一位，Codex 規劃）  | 實際規劃工具是 Codex                                           | `--agent claude --model claude-opus-5-5 --effort xhigh`                                                         |
| `advisor`（第一位，Claude 規劃） | 實際規劃工具是 Claude                                          | `--agent codex --model gpt-6.2-sol --effort xhigh`                                                              |
| `advisor`（第二位）              | 每次徵詢，與第一位同時派工                                     | `--agent antigravity --model gemini-4-hydrogen-xhigh`                                                           |

Antigravity 的強度已在模型 ID 裡，省略 `--effort`。Pi 可由當前 `worker-start` 直接接收模型。使用啟動回執核對實際模型、強度與工作區。若目前版本拒絕參數，保留完整錯誤並依指南處理。

## 1. 分工

- 主工作區（`ledger-app` 的 `main`）統整方向、優先序、跨工作區相依與共用資源。主工作區把工作範圍分配給負責的工作區。
- 各工作區在已核可範圍內自行拆任務、派子 worker、續派、驗收與開 PR。子 worker 把成果交給派工的工作區協調者。線內問題與需核可的事項，在該工作區與開發者討論。
- 只有完成可能影響其他分支進度的節點，才向主工作區回報。例如共用 API 已合併，下游可以開始串接。回報列出受影響的分支、完成結果、驗證證據與下一步。只影響本線的規格核可、驗收或 PR 合併，記在本線交接即可。
- 發現跨線阻塞或共用資源衝突時，立即聯絡主工作區協調。例如兩線需要同一個 Web e2e 時段。
- 實作依 §0 選 `default` 或 `backend`。當地協調者可自行寫 `packages/shared` 的型別契約、先寫授權與隔離測試並確認失敗，或處理拆派成本更高的小修。網頁設計與實作皆由 Codex 負責。當地協調者可以評閱設計，網頁修正交回 Codex。
- schema、API 與授權的產出由當地逐行驗收。驗收者自己重跑隔離測試與兩套 e2e，遵守 §3 的資源限制。
- 需帶回結果的工作用 `orca orchestration`；單純交接用 `orca-cli`。

### 1.1 徵詢 `advisor`

開發者要拍板的事，包含 Ask first、方案取捨、偏離 spec 與 spec 的假設，先同時徵詢 2 位獨立的 `advisor`。

1. 由需要決策的工作區協調者建立任務，並指派兩位顧問。依實際規劃工具選第一位，第二位固定取 §0 的第二位。兩位各用獨立 Dispatch，同時開始。唯讀徵詢可沿用規劃所在的工作區，明確傳入工作區選擇值。
2. 給兩位相同的背景、已知事實、問題與候選方案。先保留規劃者的偏好和另一位顧問的意見。請各自回報建議、理由、代價、遺漏的方案與風險。
3. 徵詢須唯讀。禁止改檔、commit、資料庫測試、e2e 與 `prisma migrate`。以繁體中文透過 `worker_done` 回報。
4. 收齊兩份獨立意見後，只就分歧交換新證據。沒有新證據時保留分歧。核對徵詢期間的工作區變更與 Dispatch 狀態。
5. 向開發者並列兩份建議、規劃者的建議、共識與分歧。若有顧問不可用，註明哪一份缺失及原因，再交開發者核可。

只請開發者提供資訊或確認畫面時，直接在當地詢問。

## 2. 派工與放置

需要處理整份已核可的 spec 時，讀 [`implement-spec`](../.agents/skills/implement-spec/SKILL.md)。使用 Orca 的 Task 相依記錄，並確認成果已驗收且進入整合基底，才續派後續任務。

```bash
orca orchestration run-create --objective "<目標>" --json
orca orchestration task-create --spec "<自足的 Task spec>" --deps '["<前置 Task ID>"]' --json
orca orchestration task-list --ready --brief --json

# 新實作 worker 預設在呼叫者的子工作區。角色參數取自 §0。
orca orchestration worker-start --task <task_id> --worktree new-child --name <短名> --base-branch <整合基底> --setup run <角色參數> --json

# 預建工作區時明確指定父工作區。指定分支名時用 --branch。
orca worktree create --name <短名> --parent-worktree <父工作區> --base-branch <基底> --branch <分支> --setup run --json

# 已有工作區時沿用。唯讀 advisor 各自用同一形式獨立派工。
orca orchestration worker-start --task <task_id> --worktree <既有工作區> <角色參數> --json
```

- 由負責該任務的工作區執行上例。只有前置任務存在時才傳 `--deps`。
- 預設子工作區。只有使用者明確要求頂層時，才用 `new-top-level` 或 `worktree create --no-parent`。跨主機建子區時依 placement 指南查回執的實際父區。舊主機若無法保證子區放置，先停下確認。
- 先派所有可獨立執行的任務。無本地工作可推進時結束回合，等 Orca 喚醒。終端機若收到具體 `check` 指令就照做。禁止以輪詢、`check --wait` 或監看腳本取代喚醒。
- `worker_done` 由 Orca 結算 Dispatch。工作區仍要驗收及整合，才解除相依。需要修正時，依 Orca 指南用 `send --to dispatch:<dispatch_id>` 送後續工作，或依 §4 重派失敗的 Task。
- 活動狀態不明時先查 `worker-show` 與 `worker-read --dispatch <dispatch_id> --source auto`。聊天 worker 可能沒有終端機。依回執的 `next` 與 recovery 指南處置。沉默、逾時或無法驗證存活都不足以判定結束。
- 需要使用者保留的 worker 用 `--keep-open` 或 `worker-keep-open`。已結案的工作區依 §7.2 清理。

## 3. Task spec

Task spec 要自足。已派 worker 讀本節、任務指定規格與適用分層指引。需要派工或交接時再讀全份指南。五欄：**Target**（範圍內的檔案）、**Change**（要產出的結果）、**Constraints**（不准碰的邊界）、**Ownership**（可以改什麼、與其他 worker 的界線）、**Observable acceptance**（證明完成的測試或輸出，寫成可逐項打勾的清單）。

Constraints 每次都寫下適用的環境與品質限制：

- 不准動 Prisma schema 與 API 介面，需要動就回報（Task spec 明確指派的除外）。
- 除非 Task 指定，worker 不跑 e2e。若需跑資料庫指令或 e2e，先依[測試環境](operations/test-environment.md)核對目標與平行限制。

- 只對自己的 Target 檔案跑 `pnpm exec prettier --write <檔案>`，不要跑根目錄的 `pnpm format`。平行時會改到別人的檔案。
- 完成前跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`。
- 遇到 provider 錯誤時，把錯誤訊息原文用 escalation 或 `worker_done --outcome failed` 帶回來。不要自己重試，也不要只寫「失敗」。（額度完全用完時 worker 發不出回報，所以協調者還要自己查，見 §4。）

會碰 Prisma 時，派工前由當地協調者依[測試環境](operations/test-environment.md)準備專屬資料庫。

依 agent 再加：

- **Codex**：Task 開頭寫「先讀根目錄與對應 app 的 `CLAUDE.md`」。Orca 的 Codex 帳號以 `project_doc_fallback_filenames = ["CLAUDE.md"]` 載入根目錄。從根目錄啟動的 worker 仍要讀對應 app 指引。新增帳號時在該帳號的 `config.toml` 補上此設定。
- **Claude**：加一句「清單還有未完成項目、又沒有東西擋住你時，不要用摘要結束回合，直接做下一項」。Claude 做長任務時，可能報完進度就停下，`worker_done` 也沒送出。

通用規則（金額不用浮點數、授權 deny by default、前端不寫業務邏輯、註解用繁體中文）已寫在 `CLAUDE.md`，不必重抄。

## 4. 額度與恢復

### 4.1 子工作區的新規劃

每次啟動子工作區的新規劃前，重新查 `orca account list --json` 的當前 Codex 用量。從 `result.rateLimits.codex.session.usedPercent` 讀 5 小時視窗，從 `result.rateLimits.codex.weekly.usedPercent` 讀週視窗。核對 `windowMinutes`（300 與 10080），只擷取用量與重置時間。禁止輸出完整回應或帳號資訊。

- 遇到缺值先重新整理用量，必要時查同一帳號的用量畫面。仍缺值或為 `null` 時，明列該視窗為「未知」。
- 任一已回傳的用量達 **80%**，該次規劃選 §0 的 `planner`（單次切換）。
- 沒有已知數值觸發門檻時，沿用 §0 的 Codex `planner`。保留未知視窗的標記。
- 80% 門檻只套用該次子工作區規劃。下次新規劃重新查。主工作區、實作、顧問及既有聊天各依原角色。

以下範例只顯示兩個視窗的用量。先在實際要開規劃的主機上執行。

```bash
orca account list --json | node -e "let input = ''; process.stdin.on('data', chunk => input += chunk); process.stdin.on('end', () => { const codex = JSON.parse(input).result?.rateLimits?.codex; for (const [label, window, minutes] of [['5h', codex?.session, 300], ['weekly', codex?.weekly, 10080]]) { const percent = window?.windowMinutes === minutes && Number.isFinite(window.usedPercent) ? window.usedPercent : 'unknown'; console.log(label, percent); } });"
```

### 4.2 實作額度與失敗

- 派工前查當前用量和已知 provider 錯誤。Codex 實作碰到實際額度錯誤才判定用完。其他 provider 可依額度錯誤或已知視窗用量達 95% 判定。查不到的額度記為未知。短暫的 rate limit 可在已確認停下後依回執重試同一角色一次。
- 一般 `default` 任務照 §0 的備援順序。網頁保留給 Codex，額度用完時回報開發者並等重置。高風險 `backend` 任務也保留給 Codex。一小時內會重置就等重置，否則向開發者說明。Claude 的 5 小時用量超過 80% 時暫緩 `fallback-3`，保留協調所需額度。
- 記下已知的重置時間。下一次派工前重新判斷，恢復後回到首選。查不到額度的備援若因額度停下，記下時間，5 小時後可再試。已執行的 worker 繼續完成。
- 啟動失敗先讀回執的 `failedStage`、`residualResources` 和 `next`，不要原樣重送。確認舊嘗試已結束且可重派後，使用原 Task 和 `--retry-of`，重新指定工作區與角色。額度切換及恢復時向當地開發者說明。
- 依 recovery 指南處理未知結果、停止與釋放。若達重試上限，回報證據並等待明確授權。保留可能還在執行或由使用者接手的資源。

```bash
orca orchestration worker-list --run <run_id> --include-remote --json
orca orchestration worker-start --task <task_id> --retry-of <dispatch_id> --worktree <工作區選擇值> <角色參數> --json
```

## 5. 工具差異

- Codex 由 Orca 管理的啟動使用當前 Orca 帳號。直接跑系統 CLI 可能使用其他帳號或模型清單。核對 Orca 啟動回執。
- Pi 按 `AGENTS.override.md`、`AGENTS.md`、`CLAUDE.md` 找第一份目錄指引。專案維持 `CLAUDE.md`。Pi 的 Flash 備援限角色表指定的簡單工作，測試、Prisma、API、授權、spec 與 plan 皆不適用。
- 遇到信任、登入或代理工具配置問題，讀 Orca 回執與對應指南。修好後先核對舊資源，避免重複啟動。
- worker 回報全綠後，驗收者仍查完整的 `git status`、`git diff`，並重跑 `pnpm typecheck` 與 `pnpm test`。Antigravity 過去曾漏報型別錯誤與測試逾時。

## 6. Session 交接

### 6.0 舊聊天收尾

新 session 確認接手後，舊 session 停止寫入。回報新舊 session 的識別值，由開發者關掉舊分頁。終端機可提供 `orca terminal close --terminal <舊 handle>`；原生聊天由開發者在 Orca 關閉。任何還在執行或由開發者保留的聊天照原安排。

### 6.1 舊 session

更新自己工作區的 `docs/handoff/<工作區>.md` 和入口中對應的一列。記下現況、下一步、開發者決定、未驗收事項與證據連結。有 Run 時，記下 Run ID、尚未處理的任務與必要決策。沿用當前指南處理待回覆訊息。

### 6.2 新 session

在既有工作區依角色表啟動新 session，沿用使用者的 Orca Chat／CLI 偏好。主工作區取協調者角色。子工作區要展開新規劃時先做 §4.1，再取對應的 `planner`。

```bash
orca agent launch --worktree <既有工作區> <角色參數> --prompt "讀 docs/handoff.md 與自己工作區的交接檔。先確認分支、HEAD、下一步與待核可事項。" --json
```

核對回執的實際工作區、session 識別值與角色。如回覆遺失，依回執提供的 `--retry-launch` 接續。已有 Run 要移交時，先由舊 session 停止處理，再在新 session 依指南用 `run-use` 綁定。以 `task-list`、`worker-list` 和待處理訊息核對狀態。接手後在當地與開發者確認下一步。符合 §1 的節點才回報主工作區。

### 6.3 何時換 session

完整工作單位做完、開發者的要求已處理，且沒有進行中的 worker、待答訊息或驗收時，可以換 session。對話太長時先把證據和待辦寫進 plan 與交接檔，再到安全的交接點更換。單一 PR 合併時若同一工作仍在進行，保留原 session。

## 7. 環境

- 先用環境中的 `orca`。不在 PATH 時，Windows 桌面安裝常見於 `%LOCALAPPDATA%/Programs/orca/resources/bin/orca.exe`。
- worktree 的實際路徑、分支與父區看建立回執。新 worktree 先跑 `pnpm install`，各自使用自己的 `node_modules`。

### 7.1 worktree 規則的細節（`CLAUDE.md` §11）

worktree 是硬碟上獨立的一份簽出，與主工作區共用同一個 `.git`，但工作目錄的檔案是各自的實體副本。

- `pnpm install` 會連帶執行 `postinstall: prisma generate`，把 Prisma Client 產到該 worktree 自己的 `node_modules`。不同分支的 lock 檔與 Prisma schema 可能不同，所以不能跨 worktree 共用 `node_modules`。
- `.worktreeinclude` 目前列 `apps/api/.env`、`apps/api/.env.test`、`.claude/settings.local.json`。
- 資料庫、連接埠及平行限制見[測試環境](operations/test-environment.md)。
- Orca 的 hook 在 `~/.claude/settings.json` 與 `~/.orca/`，skill 在 `~/.agents/skills/`，都在 repo 之外，CI 用不到。可用的 skill：`orca-cli`（worktree、終端機、內建瀏覽器）、`orchestration`（多 agent 協調）、`orca-per-workspace-env`（容器 / VM 環境配方，目前用不到）。

### 7.2 每週清理

每週日 **10:00（Asia/Taipei）** 從 `ledger-app` 的 `main` 整理。只處理同一專案的工作區。既有工作區維持原父子關係，只有目前沒有父區的工作區可檢視是否需要調整。

1. 從同一專案盤點工作區，核對其交接與 PR 狀態。關閉前立即重查，避免把整理開始時的結果當成當前狀態。
2. 核對分支獨有提交、已追蹤變更、未追蹤檔與 Git 忽略檔。分支獨有提交要確認是否已有可查的保存位置或對應合併證據。帳務、匯入與憑證只列類別，省略檔名與內容。
3. 核對 worker、聊天、終端機、子工作區、遠端連線與活動狀態。先查 Orca 可見的狀態，再核對相關主機。活躍子區或遠端連線仍依賴父區時保留父區。
4. 進行中、待挑的試稿、尚未保存、仍有連線或狀態未知，一律保留。結案且證實已保存、沒有活動才可關閉。暫停且確認已保存又無活動的工作，可以保留分支、只移除工作區。
5. 先確認目標主機支援移除工作區時保留分支。使用明確的工作區選擇值。若工具可能刪除要保留的分支或效果不明，保留工作區。整理後回報關閉及保留的工作區與原因。

依當前 Orca 指南 的 recovery 流程釋放已結案且由協調者擁有的 worker。回執若顯示釋放尚未確認，保留相關工作區。清理範例在支援保留分支的主機上適用。

```bash
orca worktree rm --worktree <明確的工作區選擇值> --json
```
