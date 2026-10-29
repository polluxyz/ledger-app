# 首頁帳戶卡視覺提案

狀態：**已核可（方案 A）**。依核可範圍調整首頁帳戶清單樣式與單元測試。

## 問題與原因

- 帳戶卡由 `apps/web/src/features/accounts/HomeAccountList.tsx:9-38` 渲染。它保留 API 順序、隱藏沒有交易的臨時帳戶、把已使用的臨時帳戶顯示為「臨時帳戶」，並列出全部可見帳戶；6 個以上才套用多欄 class。這些資料與行為都沿用。
- `apps/web/src/features/home/card-registry.tsx:24-33` 登記八張卡與各卡最小寬度；帳戶卡固定最小寬 309px。視覺修改不動登記、最小寬度或版面資料。
- `apps/web/src/features/accounts/HomeAccountList.module.css:12-38` 現在以分隔線呈現各列、固定金額不換行；名稱使用 `overflow-wrap: anywhere`，長名稱會折成多行，列高與金額對齊因此不穩定。`49-55` 以清單容器 440px 為兩欄門檻；欄位配置會改為明確的一欄／兩欄尺寸，並將長名稱省略，讓窄卡與兩欄都能維持整齊。
- `apps/web/src/features/accounts/HomeAccountList.test.tsx:43-69,96-127` 已驗證 5 個帳戶一欄、6／12 個帳戶全數顯示，以及負餘額語意色與 440px 容器查詢；目前沒有長名稱省略的驗證。
- 2m 將首頁收斂成黑金／象牙金層次，以中性文字和分隔線整理清單、以表格數字對齊金額，負值沿用支出語意色（`docs/specs/phase-2m-home-visual-refresh.md:7-12`）。基底卡使用設計 token、髮絲邊與柔和陰影（`apps/web/src/features/home/HomeCard.module.css:1-16`）；趨勢卡強調等寬數字與 muted 標籤（`apps/web/src/features/statistics/HomeFinancialTrendChart.module.css:19-49`），借還列使用留白與細分隔線（`apps/web/src/features/debts/DebtsCard.module.css:7-24`）。

## 做法比較與推薦

| 做法                      | 視覺                                                                         | 優點                                                                                   | 代價                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **A．細線帳簿列（推薦）** | 名稱單行省略，金額靠右使用等寬數字；列間留白與細線分隔；負數使用既有支出色。 | 延續借還／統計清單的節奏；309px 仍可一眼掃讀，560px 時兩欄密度自然；不加裝飾或新資訊。 | 外觀較克制，沒有額外的帳戶類型辨識圖示。                             |
| B．餘額膠囊               | 延續單列排版，金額置於淡底圓角小底片，負值仍用支出色。                       | 金額區塊更明確，視線容易落在餘額。                                                     | 309px 與兩欄狀態會壓縮名稱空間；每列多一個視覺塊，首頁八卡較顯繁複。 |
| C．雙層小卡               | 每個帳戶以淡填色小磚呈現，名稱在上、金額在下；兩欄時排列成磚格。             | 單一項目辨識度高，長名稱有較多獨立版面。                                               | 八個帳戶時高度增加；與其他首頁卡片的清單語言差距較大。               |

推薦 A。它保留既有清單結構，透過單行截斷與金額層級解決目前的閱讀問題，並最貼近 2m 的借還及統計清單。正值沿用一般文字色，不擴大金色使用範圍；負值繼續使用 `--color-expense`。此方案只改呈現，不增加帳戶資訊或互動。

## 預覽

- 比較頁：[docs/artifacts/home-account-card/index.html](../../docs/artifacts/home-account-card/index.html)（self-contained HTML，不進版控）。
- 頁面並排比較 A／B／C，提供 3／8 個帳戶、309／390／560px 卡寬與深／淺主題切換。樣本含長帳戶名稱與負餘額；8 個帳戶在清單容器達 440px 時呈現兩欄。
- 預覽只使用虛構帳戶名稱與金額，顏色、字級、圓角、間距和動態 token 對應 `apps/web/src/styles/global.css`。預覽不載入外部資源，也不使用動畫。

## 影響檔案與實作順序

1. `apps/web/src/features/accounts/HomeAccountList.module.css`：實作核可方案的列間距、單行省略、金額對齊與窄欄安全寬度；保留 440px 容器查詢及負數語意色。
2. `apps/web/src/features/accounts/HomeAccountList.test.tsx`：補長名稱省略樣式與 5／6+ 個帳戶欄數規則的單元測試；保留目前的全數列出、順序和負值測試。
3. `apps/web/src/features/accounts/HomeAccountList.tsx`：只有 CSS 呈現若需要掛上既有語意 class 才修改；不改資料篩選、順序、可見數量或互動。
4. 本提案一併提交；HTML 預覽保留在被忽略的 `docs/artifacts/`。

## 驗收條件

- [x] 帳戶資料、API 順序、空臨時帳戶處理、負餘額格式、清單數量與點擊目標不變；5 個以下維持一欄，6 個以上在清單容器寬度達 440px 時兩欄，窄於 440px 時一欄。
- [x] 單元測試覆蓋一欄／兩欄切換、負餘額樣式，以及長名稱的單行省略規則；省略僅影響視覺，完整名稱仍在 DOM 中供讀屏取得。
- [ ] 協調者在瀏覽器把帳戶卡實際寬度設為 309px、390px、560px，對 `ul[aria-label="帳戶"]` 驗證 `scrollWidth <= clientWidth`。8 個帳戶在 560px 卡寬下，另確認列項目分成兩個水平起點；309／390px 時確認為一欄。
- [x] 深色與淺色均沿用全域設計 token；正負金額在兩主題下均可辨識，長帳戶名稱不增加列高。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、Web build 全部 exit 0；不執行 e2e，由協調者依上項驗收。

## 測試策略

- `HomeAccountList.test.tsx`：沿用元件渲染測試驗證 5 個帳戶不加多欄 class、8 個帳戶加多欄 class；以 CSS module 檔案內容確認 440px 容器規則、欄寬／box sizing、名稱 `white-space`／`overflow`／`text-overflow` 與負餘額 class。JSDOM 不會排版 CSS 容器查詢，因此實際欄位位置及 `scrollWidth <= clientWidth` 留給協調者 e2e 在真實瀏覽器量測。
- 不跑 Playwright 或 API e2e；不改 CI。
- 完成前以 `fnm exec --using=24.22.1` 執行指定 lint、typecheck、test、format:check 與 build。只對本次更動檔案執行 Prettier。

## 需要開發者核可

- 此提案推薦方案不變更資料模型、API、相依套件、CI、資料與互動。除本提案的設計核可外，沒有其他待核可項目。

## 實作紀錄（2026-10-28）

- 已依核可的 A 方案調整列高、名稱省略與窄寬欄位尺寸；`HomeAccountList.tsx` 無需修改，因既有元件已提供所需 class 和完整名稱文字。
- 測試確認 5 個帳戶維持單欄、6／12 個帳戶套用多欄樣式、440px 容器查詢將列寬改為 50%，以及負餘額語意色與長名稱單行省略。`HomeAccountList.test.tsx`、CSS 樣式檔與提案已通過 Prettier。
- 最終驗證：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm --filter @ledger/web build` 均 exit 0。測試數為 shared 160、API 956、Web 1,134，合計 2,250。第一次把全部檢查併行執行時，17 個 Web 測試碰到 5 秒逾時；將完整 `pnpm test` 單獨重跑後 1,134 個 Web 測試全數通過。
- 未執行 e2e；309／390／560px 的真實瀏覽器 `scrollWidth <= clientWidth` 與兩欄位置仍待協調者依前述條件驗收。
- 實作未偏離核可方案；commit hash 隨 worker_done 回報。
