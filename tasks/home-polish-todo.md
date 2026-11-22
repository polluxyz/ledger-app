# 2n 首頁去除冗餘與窄寬修整：todo

依據 [spec 2n](../docs/specs/phase-2n-home-polish.md) 與 [plan](home-polish-plan.md)。每項完成後勾選並填驗收證據。

- [x] **T0 文件（協調者）**：2l W275 末尾加「2n 決策 414 修訂標題與副標」；spec、plan、todo 一起提交。
  - 驗收：`git diff` 只含 `docs/specs`、`tasks`；`pnpm format:check` 通過。
- [ ] **T1 W312 支出分類卡**：`categories` 卡標題「支出分類」，副標「帳本名稱 · YYYY 年 M 月」（個人與共享都顯示）；`card-registry` 標籤、拖動預覽、分隔線名稱跟著改；`expense` 卡維持「本月支出」。
  - 驗收：SC-N6；元件測試涵蓋個人、共享副標；相關 e2e 字串只改 `categories` 的部分。
- [ ] **T2 W309 趨勢詳情與 `$`**：詳情只在選取非最新月份時顯示；主數字 `$`（含負號）沿用摘要卡 `statCurrency` 樣式。
  - 驗收：SC-N4；元件測試涵蓋未選、選最新、選其他月份、切換指標、負數拆分；2m SC-V1～V4 e2e 通過。
- [ ] **T3 W310、W311 待確認卡**：≤40rem 時 `.smallButton` 高度 ≥44px；日期移到「X 記了一筆 · M/D：」後再接箭頭。
  - 驗收：SC-N5；元件測試驗日期位置；e2e 量 390px 按鈕 ≥44px、1280px 為 30px。
- [ ] **T4 W308 首頁交易列**：`.homeActivityRows` 內沒有副標內容的列不保留空白副標高度。
  - 驗收：SC-N3（1280px 與 390px 無副標列比基線少 ≥20px，有副標列不變高）；SC-Y30 通過；交易頁 52px 斷言通過。
- [ ] **T5 W307 窄寬摘要卡橫排**：只在 `data-home-layout="narrow"`；第 1 行標題＋金額，第 2 行副標＋「我 $X」；圖示在標題左邊；結餘淡金底與圓弧保留；DOM 順序不變。
  - 驗收：SC-N1、SC-N2；1280px 三卡與基線一致；`stats.spec.ts` 連結名稱斷言不改仍通過。
- [ ] **T6 全套驗證與截圖**：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、Web build、全站 Web e2e；截 8 張（深淺 × 個人／共享 × 1280／390）到 `docs/artifacts/home-unslop-after/`（不進版控）。
  - 驗收：SC-N7、SC-N8；回報各指令 exit code 與測試數量。
- [ ] **T7 協調者驗收**：讀完整 `git status` 與 `git diff`；自己重跑 typecheck、test、首頁與版面編輯 e2e；逐張對照基線截圖；開 PR，CI 全綠後交開發者確認，不自行合併。
  - 驗收：plan「驗證結果」填入實際數字；PR 連結 spec 2n。
