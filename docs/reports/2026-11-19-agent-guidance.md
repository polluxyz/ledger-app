# Agent 指引英文版驗收

根指引每次少 1019 個 token。按需文件各讀一次，合計少 6615 個。以下比較 ledger app 基底 `7b99e23e55ad65d305c9be1035e2982f01214afe` 與本報告所在的改版。兩版使用相同切分規則。

## 入口與使用時機

| 時機              | 專案內的來源                                                                                      | 如何載入                                                                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 每次從根目錄啟動  | `CLAUDE.md`                                                                                       | 本次 Orca Codex 對話收到完整根指引。Orca 帳號以 `project_doc_fallback_filenames = ["CLAUDE.md"]` 載入。Claude Code 使用同名入口。Pi 同層依序找 AGENTS.override.md、AGENTS.md、CLAUDE.md。                   |
| 技能發現          | SKILL.md 檔頭、3 份 agents/openai.yaml                                                            | 發現階段可見名稱與描述，呈現內容依工具而異。本次 Codex 的專案技能清單只列 `pr`。手動技能的政策與介面文字放在 YAML。清單費用和載入全文分開計算。                                                             |
| 路徑與任務觸發    | API、Web 的 CLAUDE.md，docs/README.md，docs/operations/                                           | 從根目錄修改某一層前讀該層。從子目錄啟動時也可能載入該層。依作業讀測試環境、部署或匯入手冊。文件索引混有使用說明及人讀的階段狀態。                                                                          |
| 使用技能或建立 PR | .agents/skills/、.claude/skills/、.github/pull_request_template.md                                | pr、implement-spec、retro 各有一份權威全文。Claude 的同名檔轉接到權威來源。其餘 3 個 Claude 技能各自獨立。systematic-debugging 的 3 份英文參考按需讀取。GitHub 建立 PR 時顯示範本，agent 撰寫時依範本填寫。 |
| 派工、接手、清理  | docs/orca-multi-agent.md、docs/handoff.md、docs/handoff/                                          | 協調者依操作讀完整手冊，受派者讀 §3 與 Task 指定段落。接手時讀入口及自己的交接。保留活動分支的現況、決定與既有證據。                                                                                        |
| 壓縮後            | .claude/settings.json、.claude/hooks/compact-status.mjs                                           | compact 事件執行 hook，注入當下的 Git、PR、Orca 狀態。兩版均不把程式全文或交接檔當成每次輸入。                                                                                                              |
| 人讀及查證        | README、docs/specs/、專案決策脈絡.md、tasks/、docs/reports/、docs/artifact-prompts.md、已結案交接 | 規格、計畫及決策在相關任務仍須查證。歷史報告、範例 prompt 與結案紀錄保留原文。未把整個文件庫當成一個 session 的輸入。                                                                                       |

Git 基底沒有模式為 `120000` 的符號連結。3 個 Claude 轉接入口都是普通檔，只有檔頭與指向權威檔的連結。沒有專案版 AGENTS.md。此次帳號的全域 AGENTS.md 與系統 Codex 版本雜湊相同，均在 repo 外。全域回答風格與 Orca 提供的技能、模型系統提示均未列入專案節省量。沿用 retro 原有的量測指令，其引用的外部門檻不作本案驗收標準。

## 文件量測

| 文件群                   | 份數 |  原版 |  新版 |          節省 |
| ------------------------ | ---: | ----: | ----: | ------------: |
| 每次載入的根指引         |    1 |  3275 |  2256 | 1019（31.1%） |
| 按需文件全文，各讀一次   |   24 | 28864 | 22249 | 6615（22.9%） |
| 介面設定、範本與結案查閱 |    5 |   832 |   832 |             0 |

按需總量包含不同工具的入口與不同角色的文件。例如，Codex 撰寫 PR 會用權威技能和範本，這 2 份合計 1603 → 1081。Claude 經轉接入口時另加 100 → 51。每次另以相同格式計算可見的 `pr: <description>` 文字為 48 → 19，少 29 個 token。這是專案描述的估值，未計工具外框，也不與含檔頭的全文加總。未量測線上帳單或快取折抵。

| 完整檔案                                                         | 分類           | 原版 | 新版 | 差額 |
| ---------------------------------------------------------------- | -------------- | ---: | ---: | ---: |
| `.agents/skills/implement-spec/SKILL.md`                         | 按需           | 2599 | 1680 |  919 |
| `.agents/skills/implement-spec/agents/openai.yaml`               | 介面設定       |   55 |   55 |    0 |
| `.agents/skills/pr/SKILL.md`                                     | 按需           | 1012 |  682 |  330 |
| `.agents/skills/pr/agents/openai.yaml`                           | 介面設定       |   42 |   42 |    0 |
| `.agents/skills/retro/SKILL.md`                                  | 按需           | 1384 |  894 |  490 |
| `.agents/skills/retro/agents/openai.yaml`                        | 介面設定       |   50 |   50 |    0 |
| `.claude/skills/implement-spec/SKILL.md`                         | 按需           |  101 |   64 |   37 |
| `.claude/skills/plan-map/SKILL.md`                               | 按需           | 2170 | 1167 | 1003 |
| `.claude/skills/pr/SKILL.md`                                     | 按需           |  100 |   51 |   49 |
| `.claude/skills/retro/SKILL.md`                                  | 按需           |   94 |   66 |   28 |
| `.claude/skills/step-proposal/SKILL.md`                          | 按需           | 1850 | 1088 |  762 |
| `.claude/skills/systematic-debugging/SKILL.md`                   | 按需           | 2324 | 2324 |    0 |
| `.claude/skills/systematic-debugging/condition-based-waiting.md` | 按需           |  885 |  885 |    0 |
| `.claude/skills/systematic-debugging/defense-in-depth.md`        | 按需           |  814 |  814 |    0 |
| `.claude/skills/systematic-debugging/root-cause-tracing.md`      | 按需           | 1312 | 1312 |    0 |
| `.github/pull_request_template.md`                               | 按需           |  591 |  399 |  192 |
| `CLAUDE.md`                                                      | 每次           | 3275 | 2256 | 1019 |
| `apps/api/CLAUDE.md`                                             | 按需           |  950 |  675 |  275 |
| `apps/web/CLAUDE.md`                                             | 按需           |  903 |  596 |  307 |
| `docs/README.md`                                                 | 按需           | 3741 | 3461 |  280 |
| `docs/artifact-prompts.md`                                       | 範本／結案查閱 |  532 |  532 |    0 |
| `docs/handoff.md`                                                | 按需           |  353 |  328 |   25 |
| `docs/handoff/ai-4a.md`                                          | 按需           |  455 |  435 |   20 |
| `docs/handoff/main.md`                                           | 按需           |  160 |  159 |    1 |
| `docs/handoff/review-specs.md`                                   | 按需           |  455 |  445 |   10 |
| `docs/handoff/stats-2j.md`                                       | 範本／結案查閱 |  153 |  153 |    0 |
| `docs/operations/dev-deployment.md`                              | 按需           |  414 |  326 |   88 |
| `docs/operations/import-planning.md`                             | 按需           |  153 |  106 |   47 |
| `docs/operations/test-environment.md`                            | 按需           |  517 |  397 |  120 |
| `docs/orca-multi-agent.md`                                       | 按需           | 5527 | 3895 | 1632 |

重算時從本次提交簽出的目錄執行。使用 `tiktoken==0.14.0` 的 `o200k_base`。逐檔計算 UTF-8 全文，統一 LF，包含檔頭、Markdown、程式碼、指令、範例及結尾換行。此工具只用在工作區外的臨時環境。

```python
import re
import subprocess
from pathlib import Path

import tiktoken

base = "7b99e23e55ad65d305c9be1035e2982f01214afe"
report = Path("docs/reports/2026-11-19-agent-guidance.md").read_text(encoding="utf-8")
enc = tiktoken.get_encoding("o200k_base")
for path in re.findall(r"^\|\s*`([^`]+)`\s*\|\s*(?:每次|按需|介面設定|範本／結案查閱)\s*\|", report, re.M):
    before = subprocess.check_output(["git", "show", f"{base}:{path}"]).decode("utf-8")
    after = Path(path).read_text(encoding="utf-8")
    print(path, *(len(enc.encode_ordinary(s.replace("\r\n", "\n"))) for s in (before, after)))
```

## 判斷與技能驗收

翻譯前依原文固定下列 32 題、預期答案及來源。原始題庫 JSON 的 SHA-256 為 `ab9214ca3670d18dc96417867fa3a46fa2bf44bbd13e632439804a77f44d49cb`。不提供預期答案給開放式作答的模型。

兩版都以 `gpt-6.2-sol`、medium 及獨立的 `codex exec --ephemeral` 對話測試。第 1–25 題提供同一路徑的指引，以及相同的帳務原文摘錄。摘錄取自 3c-0 §1、3j 決策 184、2j 決策 231 和 11 月 18 日帳務審查。第 26–32 題只提供兩個技能目錄的檔頭和 3 份介面設定。工作目錄設在專案外，兩版分開送入，模型只收到題目和該版資料。安全、權限及刪除題僅文字作答。

初試採開放式簡答。兩版都選對 7 題技能。原版第 21 題漏列按鈕文字，新版沒有寫出文字欄的元素名。第 2 題兩版都省略小修的前置驗收條件。逐條回查可見這些規則仍在兩份原文中。保留「複製成 prompt」「已複製」與可見文字欄的關聯，並在 retro 的技能描述指明預設回顧當前對話。

複測用同一組 3 選 1 選項，涵蓋原題的完整預期條件。逐題比對選項代號，原版 **32/32**，新版 **32/32**。下表列題目與正解；完整複測選項隨 PR 驗收證據保存。第 1–25 題答案依序為 `BACCB AACBB ACCBA ACBBA CCBAA`（忽略空格）。第 26–32 題為 `CBBACCB`。

另用繁中請求在兩個實際 checkout 啟動 Codex。要求草擬 PR，限制只讀技能並回傳路徑與段名。兩版都實際讀取 `.agents/skills/pr/SKILL.md`，回傳「改動與原因」「驗證證據」「合併風險與回復」。這項實際入口測試各 **1/1**。Claude 的入口以檔案、設定和選擇題驗證，未啟動 Claude 對話。

|  題 | 繁中請求／情境                                                               | 預期判斷                                                                                                     | ledger app 原文位置          |
| --: | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
|   1 | 計畫已核可。加資料表、改 API、新增 Web 套件及改 CI 前各要做什麼？            | 4 項都要先說明並取得同意。API 同步提醒 Web／App 影響。                                                       | 根 §5、14                    |
|   2 | 小修在核可範圍內。提交、推功能分支、開 PR、落後 main、檢查全綠時怎麼辦？     | 先列驗收條件。自動提交、推分支、開 PR。用 gh pr update-branch 後等重跑，全綠 squash merge，由主區更新 main。 | 根 §5、10                    |
|   3 | 可直接推 main、用 --admin 合併嗎？重寫既有歷史或刪別的 PR 的遠端分支呢？     | 前兩項禁止。後兩項先取得同意。                                                                               | 根 §10、14                   |
|   4 | 新功能何時寫規格、計畫與任務清單？中途要偏離方案呢？                         | 先確認假設，規格核可才寫計畫與清單並一起送審。計畫核可才執行。偏離前取得同意。                               | 根 §5                        |
|   5 | 開發者要在 2 個方案間拍板，只要確認畫面時又該怎麼做？                        | 前者由本區同時徵詢 2 位獨立唯讀顧問，再由開發者決定。後者直接在本區問。                                      | 協作 §1.1                    |
|   6 | 已核可方案內的小問題可自行修嗎？何時向主區回報或聯絡？                       | 可以，記入計畫。完成可能影響他線進度的節點才回報。跨線阻塞或資源衝突立即聯絡。                               | 根 §5、協作 §1               |
|   7 | 只有 1 位成員的 SHARED 帳本會變 PERSONAL 嗎？帳戶與餘額歸哪裡？              | kind 不可變，也不能從人數推導。帳戶屬人。由交易即時計算餘額。                                                | 根 §6                        |
|   8 | 別人付款記哪個帳戶？何時可以沒有帳戶？                                       | 記付款成員的臨時帳戶。不經我帳戶且對應欠款，或共享帳本帳戶主人已退出，依 3h、3k 例外。                       | 根 §6                        |
|   9 | 333.33 元如何輸入、傳送、儲存？能收 USD 嗎？                                 | TWD，字串轉整數 33333 分，無浮點或 parseFloat。多幣別不在範圍。                                              | 3c-0 §1                      |
|  10 | 洛杉磯新增 10/1、只改金額時的寫入時間？交易頁與統計各按哪個日期？            | 新增 00:00Z，編輯保留原時間。交易頁依瀏覽器時區，統計依台灣時間的交易 date 而非 createdAt。                  | 帳務審查、2j 決策 231        |
|  11 | 一般交易刪除後查詢要怎麼處理？封存帳本的 editor 能取消封存嗎？               | 交易用 deletedAt 軟刪除，查詢排除。只有 owner 可取消封存。                                                   | 根 §6、API 慣例、3j 決策 184 |
|  12 | 已套用 migration。revert 程式足以回復資料嗎？PR 怎麼交代？                   | 不足。寫出部署前 pg_dump 備份的還原方式或補償 migration。                                                    | pr 合併風險與回復            |
|  13 | AI 草稿可自動入帳嗎？匯入規劃對遮蔽及寫入有何限制？                          | 兩者都要使用者確認。AI 走現有寫入流程。匯入對外送出前遮卡號及帳號。                                          | 根 §1、匯入規劃              |
|  14 | 新帳本讀取方法只在畫面與 guard 擋其他成員足夠嗎？                            | service 按帳本權限過濾、預設拒絕，補讀不到別人帳本的測試。                                                   | API 慣例                     |
|  15 | 新增金錢紀錄端點重送時以哪個帳本驗權？寫入在哪個交易？                       | 以資源目前的帳本驗權，寫入 idempotency.run 的 tx。                                                           | API 慣例                     |
|  16 | 成功登入的 e2e 與測試拒絕偽憑證，各用哪個入口？                              | 成功用 registerAndLogin 或 loginAgain，僅負面測試可用 signRawToken。                                         | API 測試                     |
|  17 | 兩個工作區各有獨立測試庫，可以同時跑 API e2e 或 Web e2e 嗎？誰先核對連線？   | API 可平行。Web 固定 3100／5273 一次一組。派工前協調者核對兩份環境檔；worker 跑 migrate 或 db 前也核對。     | 測試環境、協作 §3            |
|  18 | 新子區規劃用量 5h 未知、週 80%。如何選？這會影響既有聊天、實作嗎？           | 先刷新，仍缺則標未知。任一已知達 80% 該次改 Claude planner。下次重查，不影響其他角色或既有聊天。             | 協作 §4.1                    |
|  19 | worker 沉默、逾時，能直接重派嗎？若使用者保留該工作區，可以直接清掉嗎？      | 不能。查 worker-show、worker-read 與回執，確認結束且可重派。保留未知、仍活動或使用者接手的資源。             | 協作 §2、4、7                |
|  20 | 為讓驗收者比對，可主動掃 docs/artifacts 並提交含測試環境設定的 HTML 嗎？     | 禁止主動掃描、提交，或帶入 .env/.env.test 內容。只讀開發者指名的頁面。                                       | 根 §13、文件索引             |
|  21 | 提案已出，開發者要求改版面但未同意開工，如何處理？匯出須有哪些文字？         | 更新提案並再確認，等明確同意才實作。繁中 prompt 可見於 textarea，按鈕「複製成 prompt」回饋「已複製」。       | step-proposal                |
|  22 | 只想看規劃結構圖，是否查看 git、完成度與實作？推論出的依賴或規劃矛盾怎麼畫？ | 不查 git、完成度或程式。標明依賴為推論，規劃內部矛盾並列原文。                                               | plan-map                     |
|  23 | ai-4a 要新增雲端資源或增加權限，單看該區操作限制，原文要求什麼？             | 先向開發者說明。此條未明訂須取得同意，不擴大為核可條款。                                                     | ai-4a 操作限制               |
|  24 | 整合後要刪專屬測試庫，誰要先看什麼？哪些不能刪？                             | 先列名單給開發者確認。保留 ledger_dev、ledger_test 與使用中的 worktree 資料庫。                              | implement-spec               |
|  25 | PR 驗證後又改了實作，能援引前次全綠當本次證據嗎？                            | 重跑受影響檢查。CI 核對最新 head，列實測 commit。                                                            | pr 驗證證據                  |
|  26 | 請撰寫這次 PR，列出實測證據與回復方式。                                      | pr                                                                                                           | 技能入口                     |
|  27 | 請用 implement-spec 完成已核可的 3l。                                        | implement-spec，手動                                                                                         | 技能入口                     |
|  28 | 請用 retro 回顧本次開發紀錄。                                                | retro，手動                                                                                                  | 技能入口                     |
|  29 | 把這個切片的規劃畫成一頁，我想點代號看原文。                                 | plan-map                                                                                                     | 技能入口                     |
|  30 | 開工前給我並排版面方案，讓我選完能複製決定。                                 | step-proposal                                                                                                | 技能入口                     |
|  31 | 單元測試突然失敗，先帶我找原因。                                             | systematic-debugging                                                                                         | 技能入口                     |
|  32 | 一般實作剛收尾，沒要求復盤或啟動整份規格。哪些手動流程可以自動開始？         | 無。不可自行啟動 retro 或 implement-spec。                                                                   | 技能入口                     |

## 中文保留與逐條核對

- 保留舊標題與章節編號供原連結和文字引用查找。介面維持繁中，包括 3 份 openai.yaml、PR 欄位、角色、按鈕、範例 prompt 與給 worker 的指定開場。回答、程式註解及顧問回報各沿用原本的繁中要求。
- 保留 Web 關於 token、前端與 log 的中文句子。例外若擴張到紀錄 token，會違反根指引 §8 的遮蔽要求。
- 保留 plan-map「不要讀 git，不要讀 `apps/` 底下的程式碼」。同一技能另引用 CSS 設計 token。未自行擴大讀取權限。
- 保留 step-proposal 的「Ask first 事項」中文列。提案須列出新增環境變數。根指引 §14 的事前核可清單另有明文，沒有單列環境變數。
- 保留文件索引判斷 Markdown／HTML 的三問。當多題同時為「是」，原文未列優先序。
- 核對條件、對象、時機與例外。例：ai-4a 建立資源前先說明；根 §14 的 schema、API、相依與 CI 變更先取得同意；測試庫清單先由開發者確認；開 PR 與正常合併依 §10 自動執行。金額、幣別、日期、刪除及回復皆採上表的 ledger app 文件。

## 結構與專案檢查

核對 9 份 SKILL.md 的名稱及其原有手動限制、工具白名單，並逐一解析 3 個轉接目的地。比對 3 份 openai.yaml 原始內容、角色的啟動參數、2 條動態 Git 指令、修改文件中的 14 行 Bash 指令，以及 111 個既有標題。另檢查版控 Markdown 的相對連結與章節目標。封存計畫指向未版控 HTML 的 1 個舊引用依原規則略過。

本機通過 shared 建置、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check` 與 `git diff --check`。單元測試共 2,705 項，shared 161、API 1,221、Web 1,323。首次執行時，新工作區的 Prisma Client 有空檔，導致 3 項檢查失敗。以 `pnpm --filter @ledger/api exec prisma generate` 重新產生後重跑通過。未改 schema 或測試設定。合併前的建置與兩套端對端結果以本 PR 的 CI 為準。
