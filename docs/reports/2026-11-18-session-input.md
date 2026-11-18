# Session 文件讀取量

基底為 `cd067a1fd9c2021d507230cb2e547de90fdbbf0e`。根指引減少 2,905 個代理 token。主工作區接手所讀的專案文件減少 30.2%。一般 Web worker 減少 40.4%。

## 讀取入口

| 類別         | 讀取時機與內容                                                                                                                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自動，專案內 | Orca 的 Codex 帳號以 CLAUDE.md 作備援。本次派工輸入已包含根指引。Claude Code 以 CLAUDE.md 作專案指引。Pi 同層先找 AGENTS.override.md、AGENTS.md，再找 CLAUDE.md。兩版都有根、API、Web 共 3 份指引，沒有新增 AGENTS.md。 |
| 必讀，依角色 | 主工作區新 session 接手時讀交接入口、main 交接與多代理指南。新子工作區 planner 讀完整指南。接手既有子工作區時再讀入口和自己的交接。操作 Orca 時依指南讀當前技能。                                                       |
| 按任務必讀   | 已派 worker 依 Task 讀相應規格及決策。本次 Task 明列多代理指南 §3。操作範圍涵蓋 API 或 Web 時讀對應分層指引。使用外部 orchestration 說明回報。                                                                          |
| 按需         | 文件索引、決策理由、技能全文、部署、資料庫測試、匯入規劃及歷史交接。觸及對應操作時讀。需開發者決策時仍依根指引和多代理指南徵詢顧問。                                                                                    |

路徑見[根指引](../../CLAUDE.md)、[派工 §3](../orca-multi-agent.md#3-task-spec)、[交接 §6](../orca-multi-agent.md#6-session-交接)與[交接入口](../handoff.md)。基底已要求派工或交接才讀整份指南。一般實作情境依本次 Task 納入 §3。根部啟動時，分層指引從對應路徑讀取。表格依文件與本次派工重建，未另啟動主工作區或 planner 取樣。

## 前後數字

每格依序為「行數／Unicode 字元／代理 token」。文件使用 UTF-8 與 LF 換行。tiktoken 0.14.0 使用 `o200k_base`。實際模型的編碼可能不同。

| 文件              |               基底 |               改後 |
| ----------------- | -----------------: | -----------------: |
| 根指引            | 316／10,841／6,164 |  155／5,398／3,259 |
| API 指引          |   59／2,342／1,135 |     43／1,899／950 |
| Web 指引          |     55／1,880／979 |     49／1,709／903 |
| 交接入口          |     20／1,337／643 |       17／740／349 |
| main 交接         |     24／1,148／634 |       11／304／174 |
| ai-4a 交接        |       14／780／502 |       14／742／455 |
| review-specs 交接 |       11／520／273 |       11／520／273 |
| stats-2j 結案入口 |        5／248／153 |        5／248／153 |
| 多代理指南全文    | 187／11,547／5,815 | 183／10,929／5,470 |
| 多代理指南 §3     |     26／1,637／907 |     22／1,130／634 |

| 角色及具體路徑                                                          |                基底 |               改後 | 代理 token 減量 |
| ----------------------------------------------------------------------- | ------------------: | -----------------: | --------------: |
| 主工作區新 session 接手，根指引 → 交接入口 → main 交接 → 多代理指南全文 | 547／24,873／13,256 | 366／17,371／9,252 |           4,004 |
| 新子工作區 planner，根指引 → 多代理指南全文，尚無工作區交接             | 503／22,388／11,979 | 338／16,327／8,729 |           3,250 |
| 既有 ai-4a 新 planner，根指引 → 交接入口 → ai-4a 交接 → 多代理指南全文  | 537／24,505／13,124 | 369／17,809／9,533 |           3,591 |
| 已派 Web worker，根指引 → Web 指引 → 多代理指南 §3                      |  397／14,358／8,050 |  226／8,237／4,796 |           3,254 |
| 已派 API worker，根指引 → API 指引 → 多代理指南 §3                      |  401／14,820／8,206 |  220／8,427／4,843 |           3,363 |
| 兩層皆改的 worker，根指引 → API 與 Web 指引 → 多代理指南 §3             |  456／16,700／9,185 | 269／10,136／5,746 |           3,439 |

派工文字、規格及決策段落依任務而變，另計。規劃若涵蓋 API 或 Web，依兩版相同範圍加計分層指引。資料庫驗收才另讀測試環境（17／1,041／517）。部署才讀部署手冊（16／762／414）。規劃匯入才讀匯入入口（6／178／153）。

## 專案之外的輸入

- 系統 Codex 與 3 個 Orca Codex 帳號的全域 AGENTS.md 內容相同。每份 118／2,536／2,069。採用該全域指引的 session 兩版各加 1 份。
- 本機 `orca skills get orchestration` 為 124／6,437／1,585。`orca skills get orca-cli` 為 334／35,360／8,421。兩版用相同快照。需讀完整兩份說明的協調者或 planner 各加 10,006。使用 orchestration 回報的 worker 各加 1,585。再加已知全域指引後，主工作區為 25,331 → 21,327，Web worker 為 11,704 → 8,450。
- 專案的 `.claude/settings.json` 只在 Claude 壓縮後執行 compact hook。程式查當下分支、PR 與 Orca 狀態，沒有讀交接檔。本次未執行 hook。未知成本包括使用者層級的 hook、完整技能說明注入、工具描述與模型其他輸入。

## 改動與驗證

- 根指引保留模型、金額、授權、資料隔離、驗收與核可規則。功能進度集中到文件索引。決策理由仍從專案決策文件查閱。
- 交接保留現況、阻礙、下一步與證據連結。部署、測試環境與匯入依操作讀取。main 原部署標題保留為相容入口。活動中的語音計畫與技能指向現行段落。
- 基底掃描 178 份 Markdown、173 個相對連結。改後掃描 182 份、210 個相對連結，其中 20 個指向標題錨點。未新增失效連結。另核對根指引與 Orca 指南的文字 § 引用、3 個 Claude 薄技能入口、部署引用及 SessionStart 設定。封存計畫的一處本機 HTML 連結指向未版控產出，保留歷史引用。`gh pr diff 232 --name-only` 顯示 #232 只改 review-specs 交接，本次該檔案無差異。
- `pnpm install --frozen-lockfile`、shared 建置、`pnpm lint`、`pnpm typecheck`、`pnpm format:check` 與 `git diff --check` 通過。單元測試通過 2,684 項。shared 160，API 75 套共 1,213，Web 143 檔共 1,311。Web 使用 `pnpm --filter @ledger/web exec vitest run --maxWorkers=2`。本次未執行端對端測試、資料庫、部署、真實模型或匯入。

## 重跑文件計數

在專案根目錄執行。每列為檔案、基底與目前工作目錄。將各情境列出的文件與 §3 數字相加。Orca 技能的即時輸出可能隨版本變動。

```powershell
$env:PYTHONUTF8 = '1'
@'
from pathlib import Path
import re
import subprocess
import tiktoken

base = 'cd067a1fd9c2021d507230cb2e547de90fdbbf0e'
enc = tiktoken.get_encoding('o200k_base')
paths = [
    'CLAUDE.md', 'apps/api/CLAUDE.md', 'apps/web/CLAUDE.md',
    'docs/handoff.md', 'docs/handoff/main.md', 'docs/handoff/ai-4a.md',
    'docs/handoff/review-specs.md', 'docs/handoff/stats-2j.md',
    'docs/orca-multi-agent.md',
]

def metrics(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    return len(text.splitlines()), len(text), len(enc.encode_ordinary(text))

for path in paths:
    before = subprocess.check_output(['git', 'show', f'{base}:{path}']).decode('utf-8')
    after = Path(path).read_text(encoding='utf-8')
    print(path, metrics(before), metrics(after))
    if path == 'docs/orca-multi-agent.md':
        excerpt = r'(?ms)^## 3\. .*?(?=^## \d+\. |\Z)'
        print('section 3', *(metrics(re.search(excerpt, s)[0]) for s in (before, after)))

for name in ('orchestration', 'orca-cli'):
    output = subprocess.check_output(['orca', 'skills', 'get', name]).decode('utf-8')
    print(name, metrics(output))
'@ | uv run --isolated --no-project --with tiktoken==0.14.0 --python 3.12 python
```
