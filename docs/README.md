# 文件索引

這個專案的文件分成四類。**Markdown 永遠是唯一真相來源**，HTML 只能是衍生視圖。

| 位置              | 放什麼                             | 生命週期               |
| ----------------- | ---------------------------------- | ---------------------- |
| `docs/specs/`     | 功能規格：要做什麼、成功條件、界線 | 活文件，隨需求變更更新 |
| `tasks/`          | 進行中的實作計畫與任務清單         | 做完就歸檔             |
| `docs/reports/`   | 一次性的技術報告                   | 寫完不動               |
| `docs/artifacts/` | HTML 產出（規劃圖、提案頁）        | **不進版控**，隨時可刪 |

On takeover first read [handoff.md](handoff.md) and your `handoff/<工作區>.md`. Update at each handoff.

Read by operation: [部署手冊](operations/dev-deployment.md), [測試環境](operations/test-environment.md), [匯入規劃](operations/import-planning.md).

規範文件另外放：根目錄的 `CLAUDE.md`（怎麼做）、[`orca-multi-agent.md`](orca-multi-agent.md)（多代理派工與交接）、`專案決策脈絡.md`（當初為何這樣決定）、`README.md`（怎麼跑起來）。分層規範在 `apps/api/CLAUDE.md` 與 `apps/web/CLAUDE.md`。

---

## 開發階段

| 階段 | 內容                                     | 狀態                             |
| ---- | ---------------------------------------- | -------------------------------- |
| 零   | Repo、monorepo scaffolding、CI、分支保護 | 完成                             |
| 一   | 核心記帳：帳本、交易 CRUD、認證授權      | 完成                             |
| 二   | Web 前端                                 | 完成                             |
| 三   | 好友 + 借還帳（雙邊連動交易 + 債務物件） | 完成至 3l                        |
| 四   | AI 文字版（`AiModule` + `LLMProvider`）  | 文字版完成；語音待真實驗收       |
| 五   | 語音（STT）+ 本地模型 provider           | 桌機 Chrome 語音先行；其餘未開始 |

階段二中途插入五個小步：**2c 帳戶與餘額**（取代已廢止的 2a 付款方式）、**2d 帳本類型**、**2e 端對端測試**、**2f 版面重整**、**2g 收尾**，各有自己的 spec。階段二結束後再追加 **2h 視覺改版**（黑金主題）與 **2i 版面第二輪**；兩者都已完成。**2j 統計**原屬階段二，在階段三之後補做，已完成。

Do not implement later phases or create files for them early.

## 規格（`docs/specs/`）

| 文件                                                                               | 內容                                                    | 狀態               |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------ |
| [`phase-1-core-ledger.md`](specs/phase-1-core-ledger.md)                           | 階段一：認證、帳本、成員、分類、交易                    | 已完成             |
| [`phase-2-web-mvp.md`](specs/phase-2-web-mvp.md)                                   | 階段二：Web 前端，含 Slice 0–4 的拆分                   | 已完成             |
| [`phase-2c-accounts.md`](specs/phase-2c-accounts.md)                               | 帳戶與即時餘額、轉帳型別、帳本連動設定                  | 已完成             |
| [`phase-2d-ledger-kind.md`](specs/phase-2d-ledger-kind.md)                         | 帳本類型（`PERSONAL` / `SHARED`）                       | 已完成             |
| [`phase-2e-web-e2e.md`](specs/phase-2e-web-e2e.md)                                 | Playwright 端對端測試                                   | 已完成             |
| [`phase-2f-web-layout.md`](specs/phase-2f-web-layout.md)                           | 版面重整為 dashboard shell                              | 已完成             |
| [`phase-2g-wrap-up.md`](specs/phase-2g-wrap-up.md)                                 | 收尾：CSP、錯誤訊息在地化、分類排序                     | 已完成             |
| [`phase-2h-web-visual.md`](specs/phase-2h-web-visual.md)                           | 視覺改版：黑金主題、三欄工作台、深淺色                  | 已完成             |
| [`phase-2i-web-layout-v2.md`](specs/phase-2i-web-layout-v2.md)                     | 版面第二輪：側欄動畫、dashboard、交易分頁               | 已完成             |
| [`phase-3a-friends.md`](specs/phase-3a-friends.md)                                 | 階段三：好友邀請、邀請連結、好友清單                    | 已完成             |
| [`phase-3b-debts.md`](specs/phase-3b-debts.md)                                     | 階段三：借還帳（往來帳版；連動見 3b-2）                 | 已完成             |
| [`phase-3b1-web.md`](specs/phase-3b1-web.md)                                       | 階段三：3b-1 的借還畫面（往來帳版）                     | 已完成             |
| [`phase-3b2-linking.md`](specs/phase-3b2-linking.md)                               | 階段三：3b-2 往來帳連動（含修訂 1）                     | 已完成             |
| [`phase-3b2-web.md`](specs/phase-3b2-web.md)                                       | 階段三：3b-2 連動的畫面（含修訂 1～3）                  | 已完成             |
| [`phase-3c0-money-cents.md`](specs/phase-3c0-money-cents.md)                       | 階段三：3c-0 金額單位改成分                             | 已完成             |
| [`phase-3c-split.md`](specs/phase-3c-split.md)                                     | 階段三：3c 代墊與分帳（後端）                           | 已完成             |
| [`phase-3c-web.md`](specs/phase-3c-web.md)                                         | 階段三：3c 代墊與分帳的畫面                             | 已完成             |
| [`phase-3d-tx-list.md`](specs/phase-3d-tx-list.md)                                 | 階段三：3d 交易頁版面整理與分類圖示                     | 已完成             |
| [`phase-3e-shared-split.md`](specs/phase-3e-shared-split.md)                       | 階段三：3e 共享帳本的分帳與結清（後端）                 | 已完成             |
| [`phase-3e-web.md`](specs/phase-3e-web.md)                                         | 階段三：3e 共享帳本分帳與結清的畫面                     | 已完成             |
| [`phase-3f-unified-debts.md`](specs/phase-3f-unified-debts.md)                     | 階段三：3f 共享帳本的人併入對象頁與借還                 | 已完成             |
| [`phase-3g-debts-inline.md`](specs/phase-3g-debts-inline.md)                       | 階段三：3g 借還頁列內展開與四個子分頁                   | 已完成             |
| [`phase-3h-every-entry-has-account.md`](specs/phase-3h-every-entry-has-account.md) | 階段三：3h 每一筆帳都要對到帳戶                         | 已完成             |
| [`phase-3i-debt-entry-edit.md`](specs/phase-3i-debt-entry-edit.md)                 | 階段三：3i 借還紀錄可改名稱、帳戶、分類                 | 已完成             |
| [`phase-3j-ledger-delete-archive.md`](specs/phase-3j-ledger-delete-archive.md)     | 階段三：3j 帳本刪除、封存、取消封存                     | 已完成             |
| [`phase-3k-leave-and-merge.md`](specs/phase-3k-leave-and-merge.md)                 | 階段三：3k 退出共享帳本並合併到別的帳本                 | 已完成             |
| [`phase-3l-move-and-copy.md`](specs/phase-3l-move-and-copy.md)                     | 階段三：3l 刪除私人帳本時搬走、複製、標註交易           | 已完成             |
| [`phase-2j-stats.md`](specs/phase-2j-stats.md)                                     | 2j 統計：首頁摘要、統計頁、資產趨勢                     | 已完成             |
| [`phase-4a-ai-text.md`](specs/phase-4a-ai-text.md)                                 | 階段四：4a AI 文字記帳（一句話變成交易草稿）            | 已完成             |
| [`phase-4a-ai-new-category.md`](specs/phase-4a-ai-new-category.md)                 | 4a 補充：AI 先挑現有分類，沒有才提議新分類              | 已完成             |
| [`phase-4a-ai-quota.md`](specs/phase-4a-ai-quota.md)                               | 4a 補充：AI 記帳的每日額度與輸出上限                    | 已完成             |
| [`phase-4a-ai-vertex.md`](specs/phase-4a-ai-vertex.md)                             | 4a 補充：換模型到 Vertex AI 的 DeepSeek V4.1 Flash      | 已完成             |
| [`phase-4a-voice.md`](specs/phase-4a-voice.md)                                     | 4a 補充：語音記帳（桌機 Chrome 先試）                   | 已實作，待真實驗收 |
| [`phase-4a-ai-haiku.md`](specs/phase-4a-ai-haiku.md)                               | 4a 補充：換模型到 Vertex AI 的 Claude Haiku 5.5         | 已完成             |
| [`phase-2k-home-redesign.md`](specs/phase-2k-home-redesign.md)                     | 2k 首頁改版：卡片版面、資產卡、借還卡、分類條配色       | 已完成             |
| [`phase-2l-home-layout.md`](specs/phase-2l-home-layout.md)                         | 2l 首頁 A+ 版面與可編輯版面（拖卡片、調寬高、存伺服器） | 已完成             |
| [`phase-2m-home-visual-refresh.md`](specs/phase-2m-home-visual-refresh.md)         | 2m 首頁風格、借還圖卡與雙指標柱狀圖動畫                 | 已完成             |
| [`phase-2n-home-polish.md`](specs/phase-2n-home-polish.md)                         | 2n 首頁去除冗餘與窄寬修整                               | 已完成（#250）     |
| [`phase-2o-pages-unslop.md`](specs/phase-2o-pages-unslop.md)                       | 2o 登入、註冊、個人資料與統計頁去除冗餘，全站風格一致   | 已完成（#251）     |
| [`phase-2p-stats-balance-ring.md`](specs/phase-2p-stats-balance-ring.md)           | 2p 統計頁結餘小圓環                                     | 已完成（#252）     |
| [`r1-idempotency.md`](specs/r1-idempotency.md)                                     | R1 防重複送出（Idempotency-Key）                        | 已完成（#223）     |
| [`r6-token-revocation.md`](specs/r6-token-revocation.md)                           | R6 登出讓憑證失效（登入紀錄表）                         | 已完成（#227）     |
| [`security-baseline.md`](specs/security-baseline.md)                               | 跨階段的安全基準                                        | 長期有效           |

已廢止的規格放 [`docs/specs/archive/`](specs/archive/)，檔頭會標明被誰取代。

## 進行中的任務（`tasks/`）

For each feature pair `*-plan.md` (implementation plan) with `*-todo.md` (tasks and acceptance). Submit both together and execute through completion after approval.

Move completed files to [`tasks/archive/`](../tasks/archive/) and name them by phase.

## 報告（`docs/reports/`）

| 文件                                                                 | 內容                            |
| -------------------------------------------------------------------- | ------------------------------- |
| [`phase-0-technical-report.md`](reports/phase-0-technical-report.md) | 階段零：專案初始化的技術決策    |
| [Session 文件用量](reports/2026-11-18-session-input.md)              | 文件盤點、前後數字與驗證        |
| [記帳流程與內部程式審查](reports/2026-11-18-ledger-flow-review.md)   | 帳務、效能與刪除依據            |
| [Agent 指引英文版驗收](reports/2026-11-19-agent-guidance.md)         | 載入入口、情境驗收與 token 量測 |

## HTML 產出（`docs/artifacts/`）

Generate HTML only when side-by-side comparison or spatial relationships are needed: planning maps (`plan-map`), proposals (`step-proposal`) and mechanism diagrams. See [sample prompts](artifact-prompts.md).

Before generation read these rules and `CLAUDE.md` §13. Use only `docs/artifacts/`, exclude secrets and never proactively scan it.

1. Inline CSS, JS and data. No external `fetch()` or CDNs. The developer opens `file://`.
2. Use product design tokens from `apps/web/src/styles/global.css`.
3. Give a brief conclusion in chat with the artifact. A path alone (「頁面做好了，路徑在 X」) is insufficient.
4. Wait for explicit developer approval before starting proposed work.
5. Record agreed decisions in the corresponding `docs/specs/` or `tasks/` Markdown.
6. Read an artifact only when the developer names that page.

判斷準則（三題都不明確時預設 Markdown）：要進版控嗎？會被反覆修訂嗎？是不是靠並排比較才說得清？前兩題為「是」就用 Markdown，第三題為「是」才用 HTML。

## 程式碼檢索（codebase-memory-mcp）

Read when the index is stale or results disagree with files (`CLAUDE.md` §12). Reindex in Bash, never PowerShell:

```bash
~/.local/bin/codebase-memory-mcp.exe cli index_repository \
  --repo-path "d:/Projects/ledger-app" --mode moderate
```

- Use `--repo-path`. Passing `--path` can silently crash the indexing worker.
- `trace_path --function-name <NestJS Class>` returns no callers for constructor injection. Use `search_graph` and `in_degree` for class relationships.
- Reindex after large changes before relying on the graph.
- In a worktree the index may point to main. Check `index_status` before first use.
