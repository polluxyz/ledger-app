# 文件索引

這個專案的文件分成四類。**Markdown 永遠是唯一真相來源**，HTML 只能是衍生視圖。

| 位置              | 放什麼                             | 生命週期               |
| ----------------- | ---------------------------------- | ---------------------- |
| `docs/specs/`     | 功能規格：要做什麼、成功條件、界線 | 活文件，隨需求變更更新 |
| `tasks/`          | 進行中的實作計畫與任務清單         | 做完就歸檔             |
| `docs/reports/`   | 一次性的技術報告                   | 寫完不動               |
| `docs/artifacts/` | HTML 產出（規劃圖、提案頁）        | **不進版控**，隨時可刪 |

**換 session 時先讀 [`handoff.md`](handoff.md)**（每次交接更新）。

規範文件另外放：根目錄的 `CLAUDE.md`（怎麼做）、[`orca-multi-agent.md`](orca-multi-agent.md)（多代理派工與交接）、`專案決策脈絡.md`（當初為何這樣決定）、`README.md`（怎麼跑起來）。分層規範在 `apps/api/CLAUDE.md` 與 `apps/web/CLAUDE.md`。

---

## 開發階段

| 階段 | 內容                                     | 狀態   |
| ---- | ---------------------------------------- | ------ |
| 零   | Repo、monorepo scaffolding、CI、分支保護 | 完成   |
| 一   | 核心記帳：帳本、交易 CRUD、認證授權      | 完成   |
| 二   | Web 前端                                 | 完成   |
| 三   | 好友 + 借還帳（雙邊連動交易 + 債務物件） | 進行中 |
| 四   | AI 文字版（`AiModule` + `LLMProvider`）  | 未開始 |
| 五   | 語音（STT）+ 本地模型 provider           | 未開始 |

階段二中途插入五個小步：**2c 帳戶與餘額**（取代已廢止的 2a 付款方式）、**2d 帳本類型**、**2e 端對端測試**、**2f 版面重整**、**2g 收尾**，各有自己的 spec。階段二結束後再追加 **2h 視覺改版**（黑金主題）與 **2i 版面第二輪**；兩者都已完成。

不要提前實作後續階段的功能，也不要預先建立未來階段才需要的檔案。

## 規格（`docs/specs/`）

| 文件                                                           | 內容                                      | 狀態      |
| -------------------------------------------------------------- | ----------------------------------------- | --------- |
| [`phase-1-core-ledger.md`](specs/phase-1-core-ledger.md)       | 階段一：認證、帳本、成員、分類、交易      | 已完成    |
| [`phase-2-web-mvp.md`](specs/phase-2-web-mvp.md)               | 階段二：Web 前端，含 Slice 0–4 的拆分     | 已完成    |
| [`phase-2c-accounts.md`](specs/phase-2c-accounts.md)           | 帳戶與即時餘額、轉帳型別、帳本連動設定    | 已完成    |
| [`phase-2d-ledger-kind.md`](specs/phase-2d-ledger-kind.md)     | 帳本類型（`PERSONAL` / `SHARED`）         | 已完成    |
| [`phase-2e-web-e2e.md`](specs/phase-2e-web-e2e.md)             | Playwright 端對端測試                     | 已完成    |
| [`phase-2f-web-layout.md`](specs/phase-2f-web-layout.md)       | 版面重整為 dashboard shell                | 已完成    |
| [`phase-2g-wrap-up.md`](specs/phase-2g-wrap-up.md)             | 收尾：CSP、錯誤訊息在地化、分類排序       | 已完成    |
| [`phase-2h-web-visual.md`](specs/phase-2h-web-visual.md)       | 視覺改版：黑金主題、三欄工作台、深淺色    | 已完成    |
| [`phase-2i-web-layout-v2.md`](specs/phase-2i-web-layout-v2.md) | 版面第二輪：側欄動畫、dashboard、交易分頁 | 已完成    |
| [`phase-3a-friends.md`](specs/phase-3a-friends.md)             | 階段三：好友邀請、邀請連結、好友清單      | 已完成    |
| [`phase-3b-debts.md`](specs/phase-3b-debts.md)                 | 階段三：借還帳（往來帳版；連動見 3b-2）   | 3b-1 完成 |
| [`phase-3b1-web.md`](specs/phase-3b1-web.md)                   | 階段三：3b-1 的借還畫面（往來帳版）       | 已完成    |
| [`phase-3b2-linking.md`](specs/phase-3b2-linking.md)           | 階段三：3b-2 往來帳連動                   | 後端完成  |
| [`security-baseline.md`](specs/security-baseline.md)           | 跨階段的安全基準                          | 長期有效  |

已廢止的規格放 [`docs/specs/archive/`](specs/archive/)，檔頭會標明被誰取代。

## 進行中的任務（`tasks/`）

每個功能一組 `*-plan.md`（技術實作計畫）與 `*-todo.md`（離散任務與驗收條件）。兩者一起送審，核可後一路做到完。

做完的移到 [`tasks/archive/`](../tasks/archive/)，依階段命名。

## 報告（`docs/reports/`）

| 文件                                                                 | 內容                         |
| -------------------------------------------------------------------- | ---------------------------- |
| [`phase-0-technical-report.md`](reports/phase-0-technical-report.md) | 階段零：專案初始化的技術決策 |

## HTML 產出（`docs/artifacts/`）

只有靠「並排比較」或「空間關係」才說得清的東西才做成 HTML：規劃結構圖（skill `plan-map`）、開工提案（skill `step-proposal`）、機制圖解。範例 prompt 見 [`artifact-prompts.md`](artifact-prompts.md)。

三條不可妥協的規則寫在 `CLAUDE.md` §13：一律產到 `docs/artifacts/`（不進版控）、絕不帶入機敏資訊、不要主動掃描這個目錄當 context 來源。以下是其餘規則，**產 artifact 前先讀完**：

1. **完全 self-contained**：CSS / JS / 資料全部 inline，不 `fetch` 外部檔案、不引 CDN。開發者是用瀏覽器直接開 `file://`，`fetch()` 會被擋。
2. **視覺沿用產品的設計 token**（`apps/web/src/styles/global.css`），不要另創一套配色。
3. **產出後必須在對話中同時給簡短結論**，不可以只丟一句「頁面做好了，路徑在 X」。人不一定會馬上打開。
4. **artifact 不是決策本身**。產出提案頁 ≠ 可以開工，仍要等開發者明確同意。
5. **結論要回寫 Markdown**。artifact 上談定的決策必須寫回對應的 `docs/specs/` 或 `tasks/` 檔案，否則決策會隨頁面被刪而消失。
6. 要參考某一頁時，由開發者明確指名，不要自己去翻。

判斷準則（三題都不明確時預設 Markdown）：要進版控嗎？會被反覆修訂嗎？是不是靠並排比較才說得清？前兩題為「是」就用 Markdown，第三題為「是」才用 HTML。
