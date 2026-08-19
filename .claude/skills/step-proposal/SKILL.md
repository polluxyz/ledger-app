---
name: step-proposal
description: 某個 Step 或 Slice 開工前、需要開發者核准方案時使用。產生 HTML 提案書：並排比較替代方案、前端 Step 附版面 mockup、列出影響檔案與驗收條件，並提供「複製成 prompt」按鈕把決定回傳。產出提案不等於開工，仍須等明確同意。
allowed-tools: Read, Glob, Grep, Write, Bash(git log:*), Bash(git status:*), Bash(git branch:*)
---

# Step 開工提案書

`CLAUDE.md §5` 門控規則 2 要求每個 Step 開工前說明四件事：**要做什麼與為什麼、打算怎麼做、預期產出與驗收方式、有哪些替代方案與為什麼選這個**。

前三項用文字說得清楚。**第四項說不清楚**——方案 A 與方案 B 並排才比得出來，寫成上下兩段散文比不出來。`tasks/phase-2b-slice-1-plan.md §4` 的 D1～D6 就是現成的例子：六個決策、48 行散文，得逐字讀完才能說「同意」。這個 skill 就是把那 48 行變成看得懂的一頁。

## 當前 git 狀態

- 分支：!`git branch --show-current`
- 未提交變更：!`git status --short`

## 鐵則：提案 ≠ 開工

**產出這一頁不代表可以動手。** `CLAUDE.md §5` 規則 3 照舊：說明完停下來，等開發者明確同意（「同意」「開始」「OK」）才寫程式。若開發者提出修改意見，**更新這一頁再重新確認**，不要口頭帶過。

同樣地，這一頁**不是決策紀錄**。談定之後，結論必須回寫到 `docs/specs/` 或 `tasks/` 的 Markdown，否則決策會隨著頁面被刪而消失。

## 動筆前

1. 讀對應的 spec 與 plan，抓出這個 Step 的**驗收條件與它對應的 `SC-x`**（如 Slice 1 對應 SC-14、SC-18）。
2. 用 Glob / Grep 確認**實際會動到的檔案**——不要憑 plan 的描述猜。plan 是幾週前寫的，檔案可能已經變了。
3. 確認有沒有新增 npm 套件、環境變數、API 介面變更。這三項在 `CLAUDE.md §12` 都是 **Ask first**，必須在頁面上獨立標示，不能混在內文裡。

## 頁面區塊（依 Step 性質取用，不必全上）

**每一份都要有：**

- **這一步要做什麼、為什麼是現在做**——兩三句。plan 裡通常有現成的（如 slice-1-plan §1「2c 做完了帳戶與餘額，但畫面上完全看不到」）。
- **影響檔案樹**——新增 / 修改 / 刪除三色區分，標出各檔目前行數。
- **驗收條件 ↔ SC-x 對照**——每條驗收怎麼驗（測試指令、瀏覽器手動步驟）。
- **Ask first 事項**——新套件 / 新環境變數 / API 破壞性變更。沒有就明寫「無」。

**有替代方案時（多數情況都有）：**

- **決策卡**——一個決策一張卡，卡內把方案並排。每個方案要有：做法、代價、**選它會發生什麼壞事**。最後標出我的建議與一句話理由。
  不要只列優點——`CLAUDE.md` 要的是取捨，不是推銷。

**前端 UI 的 Step：**

- **版面 mockup，並排 2～3 個方案**。開發者對版面「還沒有特別想法、要比較看看」，所以**預設就是並排**，不要只給一個。
- **忠實度：中高。** 用 `apps/web/src/styles/global.css` 的真實 token 與既有元件樣式（見 `docs/artifacts/design-system.html`），做到「談定後樣式可以直接抄進 `*.module.css`」的程度。但要在頁面上明說**這是版面與資訊層級的提案，不是最終視覺定稿**。
- 元件外觀對齊既有的 `Button`（primary / secondary）、`TextField`、`Select`、`FormError`、`TransactionList` 的列樣式、`HomePage` 的統計卡。
- 示範資料自己編，貼近真實情境：帳戶用「現金」「國泰世華」、金額用整數（`formatAmount` 只加千分位、不做除法）、日期用 `2026/08/16` 格式。**絕不使用 `.env` 內容或真實 email / token。**

**動到資料流或執行順序時：**

- **inline SVG 流程圖**。適用情境例如：TanStack Query 的快取失效鏈、NestJS 的 Guard → Filter 執行順序、Prisma `onDelete` 的連鎖行為。不要用 ASCII art。

## 「複製成 prompt」匯出

頁面底部放一個匯出區，讓開發者在頁面上做完選擇後一鍵複製回終端機。

實作要求：

- 每個決策卡放一組單選（方案 A / B / C）加一個自由文字備註欄。
- 匯出區把所有選擇組成一段**繁體中文的 prompt**，格式如：
  `Step 4 提案：D1 選方案 B、D2 選方案 A（備註：確認彈窗不要輸入名稱）、D3 同意。其餘照提案執行。`
- **匯出文字必須始終顯示在一個可見的 `<textarea>` 裡**，按鈕只是便利功能。`navigator.clipboard.writeText()` 在 `file://` 下多數瀏覽器可用，但不保證；一定要有「看得到就能自己選取複製」的退路。
- 複製後給明確的視覺回饋（按鈕文字暫時改為「已複製」）。

## 技術要求

- 輸出到 `docs/artifacts/step-<slice>-<step>.html`（如 `step-slice-1-04-accounts-page.html`）。
- Self-contained：CSS / JS / 資料全部 inline。開發者直接用瀏覽器開 `file://`，`fetch()` 會被擋。
- 並排 mockup 在窄視窗要能改成上下堆疊，頁面本身不可橫向捲動。
- 絕不帶入機敏資訊（`.env`、`.env.test`、DB 連線字串、`JWT_SECRET`、真實 email 或 token）。這些頁面可能被拿去向別人介紹專案。

## 產出後

在對話中同時給出**這一步的一句話結論、以及需要開發者拍板的決策清單（只列題目，細節在頁面上）**。然後停下來等同意——不要接著寫任何程式碼。
