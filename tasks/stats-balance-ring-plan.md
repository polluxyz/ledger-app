# 2p 統計頁結餘小圓環：計畫

依據 [spec 2p](../docs/specs/phase-2p-stats-balance-ring.md)（開發者 2026-11-25 核可）。工作區 `web-unslop`，分支 `feature/web-stats-balance-ring`，一個 PR。

## 分工

- 協調者（Claude，web-unslop）：寫 spec、plan、todo；派工；驗收；開 PR。
- Codex worker（`default`）：在本工作區改 `apps/web` 的 CSS 與 e2e、截圖。不另開工作區、不開 PR、不合併。
- 開發者：核可 spec 與本計畫；看截圖後決定合併。

## 順序與相依

1. T0 協調者：spec、plan、todo、`docs/README.md` 規格表、2o 決策 440 註記、交接檔登記編號，同一個 docs commit。
2. T1 Codex：`StatsPage.module.css` 加圓環與 ≤600px 隱藏（W330、決策 441、442）。
3. T2 Codex：`stats.spec.ts` 加 SC-Q1、Q3 的 e2e 與 601px 溢位檢查。依賴 T1。
4. T3 Codex：全套驗證與 6 張截圖。依賴 T1、T2。
5. T4 協調者驗收：讀完整 diff，自己重跑 typecheck、lint、web 單元測試、統計 e2e，逐張看截圖，開 PR，等 CI 全綠。
6. T5 開發者看截圖確認後合併；合併後 plan、todo 移到 `tasks/archive/`，交接檔更新。

## 風險與對策

| 風險                                                     | 對策                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 圓環畫在金額上面，線條蓋住數字                           | 用 `isolation: isolate` 加 `z-index: -1`，或讓 dt、dd 設 `position: relative`；SC-Q2 用截圖逐張確認    |
| 圓環超出格子，撐出橫向捲動                               | 結餘格設 `overflow: hidden`；e2e 量 601px 與 390px 的 `scrollWidth`                                    |
| 601～750px 三格很窄，長金額伸進圓環範圍                  | 圖層順序保證文字在上；SC-Q2 用 9 位數負數在 601px 截圖                                                 |
| 結餘格加 `overflow: hidden` 後，焦點外框或其他內容被裁掉 | 結餘格內只有 dt、dd 兩個不可聚焦的文字元素；截圖比對修改前後                                           |
| 手機隱藏寫在不同的 media 區塊，順序錯了導致手機仍顯示    | 隱藏規則放在既有 `@media (max-width: 600px)` 之後或用同一選擇器；SC-Q3 在 600、390、320px 量 `display` |
| jsdom 看不到偽元素，元件測試抓不到退步                   | 用 e2e 的 `getComputedStyle(..., '::before')` 驗；既有讀屏斷言證明 DOM 沒變                            |
| 與其他工作區同時跑 Web e2e，共用測試資源                 | 依 `docs/operations/test-environment.md` 重建並使用 `ledger_web_unslop_test`；衝突時回報協調者         |

## 替代方案與取捨

- 手機縮成 56px：弧線會穿過金額最右邊 3～4 個字的後方，開發者選隱藏（決策 442）。
- 手機結餘格改回上下兩行排法以容納圓環：摘要區變高，第三格和前兩格格式不同。
- 用 container query 依格子寬度切換：可處理桌機側欄擠窄，但範圍變大，本次不做。
- 在 TSX 加 `<span aria-hidden>` 對齊首頁寫法：多改一個檔案；CSS 偽元素效果相同，且不動 DOM（W330）。

## 未處理

（實作中發現範圍外的可修處，記在這裡，不擴大本次改動。）
