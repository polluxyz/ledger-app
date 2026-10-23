# 2j 任務清單

plan：`tasks/archive/phase-2j-plan.md`；spec：`docs/specs/phase-2j-stats.md`。

- [x] **D0 契約與隔離測試**（協調者）：plan §1.1。
      驗收：`pnpm --filter @ledger/shared build` 通過；`statistics-isolation.e2e-spec.ts` 紅燈，且每條 404 斷言都有正向對照、「已退出」用真的退出 API 做出來；API／Web typecheck 通過。
- [x] **S1a 統計核心**（依賴 D0；`2j-stats-core`，`backend`）：plan §1.2。
      驗收：單元測試涵蓋決策 230、234、260（含同餘數、極小值、溢位）與台灣時間的日期邊界（跨月、閏日），並用 `TZ=America/New_York` 再跑一次；CTE 與 `attribution.ts` 的差異測試涵蓋 SC-R28 的每種資料形態與多人分帳，資料庫 session 時區換成別的再跑一次；SQL 分桶寫成先標 UTC 再轉台灣。
- [x] **W1 首頁**（依賴 D0；`2j-web-home`，Codex）：plan §1.6。
      驗收：元件測試涵蓋 W201、W206、W215、W216、SC-R14、SC-R18；換首頁帳本時資產圖不重抓；Web 檢查全綠。
- [x] **W3 圖表元件**（依賴 D0；`2j-web-charts`，Codex）：plan §1.7。
      驗收：元件測試涵蓋 W207、W220、W221、W223、W224、SC-R22 的圖表部分；元件不打 API、不自己算百分比；Web 檢查全綠。
- [x] **S1b 統計端點**（依賴 S1a；`2j-stats-api`，`backend`）：plan §1.3。
      驗收：SC-R1～R10、R12、R23、R27、R28 的 API e2e 通過，R27、R28 打真的端點；決策 262 的正負不變量在每份種子上檢查；DTO 的 400（無效 enum、`months` 是 0／25／1.5／非數字、日期格式錯、日期不存在）都有 e2e；成員資格檢查與三組加總在同一個 `RepeatableRead` 交易裡；隔離測試 SC-R7、SC-R11（§4.1、§4.2）轉綠；既有 API e2e 全綠。
- [x] **S2 資產趨勢**（依賴 S1a；`2j-balance`，`backend`）：plan §1.4。
      驗收：餘額只透過 `calculateBalances` 算；`calculateBalances` 每一步都檢查安全整數，另有中間值溢位的單元測試；SC-R16、R17（退出用真的 API）、R29 的 API e2e 通過；隔離測試 SC-R11（§4.3）轉綠；既有帳戶 e2e 全綠。
- [x] **W2 統計頁**（依賴 W1、W3；`2j-web-page`，Codex）：plan §1.8。
      驗收：`stats-url.ts` 的單元測試涵蓋優先順序、無效值、決策 265 的正規化；元件測試涵蓋 W202～W205、W222、W225、SC-R19（切圖型不重打 API）、R20、R22 的頁面部分（單一端點失敗只影響那一區）、R24～R26、決策 236；交易頁讀網址篩選的測試涵蓋再次導入、返回鍵、無效值、手動改篩選後不被覆寫；既有交易頁測試全綠；Web 檢查全綠。
- [x] **S3 效能腳本**（依賴 S1b、S2；`2j-perf`，`default`）：plan §1.5。
      驗收：`test:perf` 能跑，輸出三個端點的 p95（排序後索引 94）與 commit、Node、PostgreSQL、機器資訊；`test:e2e -- --listTests` 的清單裡沒有這個檔；資料庫名稱不以 `_test` 結尾時直接失敗、不灌資料。
- [x] **W4 Web e2e**（依賴 S1b、S2、W1、W2；`2j-web-e2e`，Codex）：plan §1.9。
      派工前：確認 ai-4a 沒有正在跑 Web e2e 的 worker。
      驗收：`stats.spec.ts` 涵蓋 SC-R15、R20、R21（390px 淺色與深色沒有橫向捲動、觸控區至少 44px）；兩套 Web e2e 全綠。
- [x] **W5 圖表畫面修正**（D1 截圖對照時追加；依賴 W4；`2j-chart-fixes`，Codex）：plan §6 D1 截圖紀錄。
      驗收：折線圖的線 computed `fill` 是 `none`，`stats.spec.ts` 有斷言；390px 月份標籤不在字中間斷開；成員清單有色塊且顏色等於圖裡同一位成員；SC-R21 仍全綠；Web 檢查與完整 Web e2e 全綠。
- [x] **W6 首頁金額與趨勢表格換行**（D1 截圖對照時追加；依賴 W5；`2j-home-fixes`，Codex）：plan §6 D1 第二次截圖紀錄。
      驗收：390px 與 1280px 下首頁 3 張摘要卡的長金額（`-$12,345,677`）只有 1 行、不截斷、整頁沒有橫向捲動，`stats.spec.ts` 有斷言；趨勢表格放得下時月份一行、放不下只在年與月之間換行；Web 檢查與完整 Web e2e 全綠。
- [x] **D1 整體驗收、PR、部署**（協調者）：plan §4。
      驗收：隔離測試紅轉綠；`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；SC-R13 三個端點 p95 < 500ms，記進實作紀錄；390px 與桌面、淺色與深色截圖逐項對過 W220～W225；spec §9 的文件影響都改了；PR 依模板、CI 全綠、squash merge；dev 照 plan §4 點過一次；worker 都 `worker-release`，worktree、子分支、worker 測試資料庫清掉。
