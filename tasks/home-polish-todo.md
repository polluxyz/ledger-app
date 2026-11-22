# 2n 首頁去除冗餘與窄寬修整：todo

依據 [spec 2n](../docs/specs/phase-2n-home-polish.md) 與 [plan](home-polish-plan.md)。每項完成後勾選並填驗收證據。

- [x] **T0 文件（協調者）**：2l W275 末尾加「2n 決策 414 修訂標題與副標」；spec、plan、todo 一起提交。
  - 驗收：`git diff` 只含 `docs/specs`、`tasks`；`pnpm format:check` 通過。
- [x] **T1 W312 支出分類卡**：`categories` 卡標題「支出分類」，副標「帳本名稱 · YYYY 年 M 月」（個人與共享都顯示）；`card-registry` 標籤、拖動預覽、分隔線名稱跟著改；`expense` 卡維持「本月支出」。
  - 驗收：SC-N6；元件測試涵蓋個人、共享副標；相關 e2e 字串只改 `categories` 的部分。
  - 證據：兩種帳本的標題與副標元件測試通過。分類卡把手、拖動預覽、移動名稱、分隔線共用登記表標籤。
- [x] **T2 W309 趨勢詳情與 `$`**：詳情只在選取非最新月份時顯示；主數字 `$`（含負號）沿用摘要卡 `statCurrency` 樣式。
  - 驗收：SC-N4；元件測試涵蓋未選、選最新、選其他月份、切換指標、負數拆分；2m SC-V1～V4 e2e 通過。
  - 證據：未選與選最新時詳情空白，選其他月份時顯示月份與金額。主數字與摘要卡的貨幣符號比例都是 0.48。SC-V1～V4 通過。
- [x] **T3 W310、W311 待確認卡**：≤40rem 時 `.smallButton` 高度 ≥44px；日期移到「X 記了一筆 · M/D：」後再接箭頭。
  - 驗收：SC-N5；元件測試驗日期位置；e2e 量 390px 按鈕 ≥44px、1280px 為 30px。
  - 證據：元件測試確認日期先於箭頭，結清文字仍在箭頭後。接受、拒絕在 390px 都為 44px，在 1280px 都為 30px。
- [x] **T4 W308 首頁交易列**：`.homeActivityRows` 內沒有副標內容的列不保留空白副標高度。
  - 驗收：SC-N3（1280px 與 390px 無副標列比基線少 ≥20px，有副標列不變高）；SC-Y30 通過；交易頁 52px 斷言通過。
  - 證據：兩個寬度皆由 96.59px 降為 69px。有副標列前後皆 97px。交易頁列高實測 52px，SC-Y30 通過。
- [x] **T5 W307 窄寬摘要卡橫排**：只在 `data-home-layout="narrow"`；第 1 行標題＋金額，第 2 行副標＋「我 $X」；圖示在標題左邊；結餘淡金底與圓弧保留；DOM 順序不變。
  - 驗收：SC-N1、SC-N2；1280px 三卡與基線一致；`stats.spec.ts` 連結名稱斷言不改仍通過。
  - 證據：390px 共享帳本摘要區 602px → 248px，待確認卡上緣 y=845px → y=491px。1280px 摘要區個人 180px、共享 202px，前後一致。
  - 證據：320px 個人 248px、共享 266px。以文字範圍量測 320px 與 390px 的長金額、負數和副標，兩種帳本皆無重疊及溢出。
- [x] **T6 全套驗證與截圖**：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、Web build、全站 Web e2e；截 8 張（深淺 × 個人／共享 × 1280／390）到 `docs/artifacts/home-unslop-after/`（不進版控）。
  - 驗收：SC-N7、SC-N8；回報各指令 exit code 與測試數量。
  - 證據：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm --filter @ledger/web build` 結束碼皆為 0。單元測試 shared 161/161、API 1233/1233、Web 1323/1323 通過。
  - 證據：原樣執行 `pnpm format:check` 因未追蹤技能目錄的 8 個檔案結束碼為 1。透過暫時的 `--ignore-path` 只排除該目錄，複驗結束碼為 0。
  - 證據：全站 Web e2e 145/145 通過，耗時 8 分 40 秒，結束碼 0。16 張截圖見 [plan 執行紀錄](home-polish-plan.md#執行紀錄)。
- [ ] **T7 協調者驗收**：讀完整 `git status` 與 `git diff`；自己重跑 typecheck、test、首頁與版面編輯 e2e；逐張對照基線截圖；開 PR，CI 全綠後交開發者確認，不自行合併。
  - 驗收：plan「驗證結果」填入實際數字；PR 連結 spec 2n。
