# 文件索引

這個專案的文件分成四類。**Markdown 永遠是唯一真相來源**，HTML 只能是衍生視圖。

| 位置              | 放什麼                             | 生命週期               |
| ----------------- | ---------------------------------- | ---------------------- |
| `docs/specs/`     | 功能規格：要做什麼、成功條件、界線 | 活文件，隨需求變更更新 |
| `tasks/`          | 進行中的實作計畫與任務清單         | 做完就歸檔             |
| `docs/reports/`   | 一次性的技術報告                   | 寫完不動               |
| `docs/artifacts/` | HTML 產出（規劃圖、提案頁）        | **不進版控**，隨時可刪 |

規範文件另外放：根目錄的 `CLAUDE.md`（怎麼做）、`專案決策脈絡.md`（當初為何這樣決定）、`README.md`（怎麼跑起來）。分層規範在 `apps/api/CLAUDE.md` 與 `apps/web/CLAUDE.md`。

---

## 規格（`docs/specs/`）

| 文件                                                       | 內容                                   | 狀態                 |
| ---------------------------------------------------------- | -------------------------------------- | -------------------- |
| [`phase-1-core-ledger.md`](specs/phase-1-core-ledger.md)   | 階段一：認證、帳本、成員、分類、交易   | 已完成               |
| [`phase-2-web-mvp.md`](specs/phase-2-web-mvp.md)           | 階段二：Web 前端，含 Slice 0–4 的拆分  | 進行中（剩 Slice 4） |
| [`phase-2c-accounts.md`](specs/phase-2c-accounts.md)       | 帳戶與即時餘額、轉帳型別、帳本連動設定 | 已完成               |
| [`phase-2d-ledger-kind.md`](specs/phase-2d-ledger-kind.md) | 帳本類型（`PERSONAL` / `SHARED`）      | 已完成               |
| [`phase-2e-web-e2e.md`](specs/phase-2e-web-e2e.md)         | Playwright 端對端測試                  | 已完成               |
| [`phase-2f-web-layout.md`](specs/phase-2f-web-layout.md)   | 版面重整為 dashboard shell             | 已完成               |
| [`security-baseline.md`](specs/security-baseline.md)       | 跨階段的安全基準                       | 長期有效             |

已廢止的規格放 [`docs/specs/archive/`](specs/archive/)，檔頭會標明被誰取代。

## 進行中的任務（`tasks/`）

每個功能一組 `*-plan.md`（技術實作計畫）與 `*-todo.md`（離散任務與驗收條件）。兩者一起送審，核可後一路做到完。

做完的移到 [`tasks/archive/`](../tasks/archive/)，依階段命名。

## 報告（`docs/reports/`）

| 文件                                                                 | 內容                         |
| -------------------------------------------------------------------- | ---------------------------- |
| [`phase-0-technical-report.md`](reports/phase-0-technical-report.md) | 階段零：專案初始化的技術決策 |

## HTML 產出（`docs/artifacts/`）

只有靠「並排比較」或「空間關係」才說得清的東西才做成 HTML：規劃結構圖（skill `plan-map`）、開工提案（skill `step-proposal`）、機制圖解。

這個目錄在 `.gitignore` 裡，**內容不進版控**，也不要拿它當 context 來源。提案頁上談定的結論必須回寫到對應的 spec 或 plan，否則決策會隨頁面被刪而消失。詳見 `CLAUDE.md` §13。
