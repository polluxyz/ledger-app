# 首頁風格實裝計畫

依據：[2m spec](../docs/specs/phase-2m-home-visual-refresh.md)。開發者已核可最後預覽並要求實裝，另指定完成後由 Claude Code 驗收。

## 實作順序

1. 財務趨勢：將既有首頁圖表改為柱圖，抽離座標與可取消動畫；首頁控制兩個指標與查詢，保留 `trend` 卡 id。
2. 借還與首頁樣式：首頁專用雙端頭像箭頭、金額、清單與重點卡片樣式，不影響借還頁的共用元件。
3. 測試與整合：元件、首頁 query 切換、動畫取消、金額精度；更新折線專屬 e2e 斷言為柱圖斷言，再執行首頁與版面編輯。
4. 交接：品質檢查、commit／push、建立待驗收 PR，將證據寫入 handoff，使用 Orca 啟動 Claude Code 接手驗收。不得在驗收前合併。

## 風險與驗證

- 資產與結餘資料範圍不同：標籤明列範圍，讀既有後端欄位，不算新帳務數字。
- 首頁可調寬高：圖面使用 ResizeObserver，維持至少 180px；窄卡讓控制列換行，借還姓名省略，金額完整。
- 動畫中途被新狀態打斷：讀當前圖面接續，清除 rAF／Web Animations；關閉動畫及卸載立即中止。
- 多個工作區共用 e2e port：執行前檢查 3100／5273／5274，使用本工作區的 `_test` 資料庫，不讀寫 dev 資料。
- 舊 e2e 有折線節點與標籤專屬斷言：更新為相等強度的柱形、零線、月份／金額與邊界驗證。

## 實作紀錄

- 基底：`d8b8720`（main）；分支 `feature/home-visual-refresh`，工作區 `stats-2j`。
- 使用者指定 Claude Code 為完成後的驗收者，因此 PR 保留待驗收狀態，不執行合併。
- schema、API、shared 契約、相依套件、CI 均無變更計畫。
- 月結餘查詢與資產查詢同時掛載，切換直接使用各自快取；每次寫入多重抓一個既有統計端點，首頁快取更新測試由 10 次改為 11 次，逐端點仍各一次。
- 移除未再使用的舊折線元件與折線專屬標籤座標測試，改由柱圖、零線、極值與鍵盤測試覆蓋。
- 瀏覽器首輪 41 條中 39 條通過：兩條失敗來自新測試尚未等手機版排版完成，以及原滑鼠來回斷言要求百分比完全相等（50 vs 49.997）。新測試改等窄版面及實際無溢出；滑鼠比例改驗到小數第 2 位（容許 0.005% 次像素差），保留鍵盤精確恢復與卡片總高 0.5px 內斷言。沒有修改版面調整器。
- 最後檢視實際手機截圖時，將窄卡最後兩個月份標籤拉開，移除多餘的摘要保留高度及舊總額樣式；相關圖表、長名稱及高度案例再次 3／3 通過。

## Codex 驗證結果

所有指令由 `fnm exec --using=24.22.1` 執行。沒有新增相依、修改 API／schema／CI 或操作 dev 資料庫。

| 項目             | 指令／操作                                                                                                                                                                          | 結果                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 格式             | `pnpm format:check`                                                                                                                                                                 | exit 0                                                                          |
| Lint             | `pnpm lint`                                                                                                                                                                         | API、Web exit 0                                                                 |
| 型別             | `pnpm typecheck`                                                                                                                                                                    | shared、API、Web exit 0                                                         |
| 全專案單元測試   | `pnpm test`                                                                                                                                                                         | shared 160、API 902、Web 1118，合計 2180 通過                                   |
| 最後圖表調整後   | `pnpm --filter @ledger/web exec vitest run src/features/statistics/HomeFinancialTrendChart.test.tsx src/features/home/HomeBalanceSummaryArrow.test.tsx src/pages/HomePage.test.tsx` | 3 檔 45／45 通過                                                                |
| 建置             | `pnpm build`，後續 Web e2e 亦重新 build                                                                                                                                             | exit 0；最大 JS chunk 290.74 kB                                                 |
| 首頁與版面編輯   | `pnpm --filter @ledger/web exec playwright test home.spec.ts home-layout-edit.spec.ts`                                                                                              | 首輪 39／41；上述兩條修正後用 `--grep 'SC-V1\|上下分隔線以滑鼠'` 重跑 2／2 通過 |
| 最後手機視覺調整 | `pnpm --filter @ledger/web exec playwright test home.spec.ts --grep 'SC-V1\|SC-Y4\|SC-H14'`                                                                                         | 3／3 通過，含 309px／390px 與深淺色                                             |

測試資料庫：`ledger_stats_test`。本機證據：`docs/artifacts/home-refresh-20261027/unit-tests.log`、`apps/web/test-results/`、`docs/artifacts/2l-aplus-shots/home-1280px-light-gold.png`（皆不進版控）。沒有重新跑全站 Web e2e 或 API e2e；完整 CI 與獨立驗收由接手的 Claude Code 確認。

## 待 Claude Code 驗收

請依 SC-V1～V8 檢查 diff、實際版面與動畫，特別核對兩組統計範圍、長名稱／金額、自訂版面與鍵盤。確認上述滑鼠次像素斷言的修正合理；如需更強證據，維持像素總高條件並補驗。驗收通過前保持 PR 待驗收狀態，不合併、不部署。
