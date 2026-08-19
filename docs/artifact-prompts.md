# HTML artifact — prompt 範本

可直接複製貼上的範本。全部使用本專案真實的模組名、檔名與術語，貼上後只需替換 Step 編號之類的少數字眼。

規範見 `CLAUDE.md §14`。產出一律落在 `docs/artifacts/`（已 gitignore）。

| #   | 用途                                 | 觸發的 skill    |
| --- | ------------------------------------ | --------------- |
| 1   | 規劃結構圖                           | `plan-map`      |
| 2   | Step 提案 — 前端 UI（含並排 mockup） | `step-proposal` |
| 3   | Step 提案 — 重構 / 後端              | `step-proposal` |
| 4   | 機制圖解                             | 無（臨時）      |
| 5   | 重新萃取設計語彙                     | 無（臨時）      |

---

## 1. 規劃結構圖

```
用 plan-map 幫我把 Slice 1 的規劃結構攤開來看。

來源是 tasks/phase-2b-slice-1-plan.md 與 docs/specs/phase-2-web-mvp.md。
我要理解的是「這個切片是怎麼設計的」，不是進度——不用標任何完成狀態，也不用讀 git。

重點放在四件事：
- 七個 Step 之間的依賴：誰非得排在誰前面、為什麼
- D1～D6 各自的結論與立場強度（哪些是「必要」、哪些其實還沒定案）
- SC-14 / SC-18 分別由哪些 Step 達成
- 範圍外的那幾項各自被指派到哪裡（轉帳 UI、帳本切換、帳戶型別、統計卡）

所有代號做成可以點開看原文的連結。
```

> 每次重新生成、覆蓋 `docs/artifacts/plan-slice-1.html`。這頁只描述規劃，不反映實作狀態——
> 想知道「做到哪」請直接看 `tasks/*.md` 的勾選，那才是驗收的真相來源。

---

## 2. Step 提案 — 前端 UI（含並排 mockup）

```
用 step-proposal 幫 Slice 1 Step 4 出一份提案：/accounts 帳戶管理頁。

依據 tasks/phase-2b-slice-1-plan.md §3 的元件規劃（AccountList.tsx、AccountDialog.tsx、
AccountBalances.tsx）與 §4 的 D3、D4、D6。對應 SC-14。

版面給我並排 2～3 個方案，我還沒有定見，要比較過才知道。三個地方特別想看：

- 帳戶列表每一列怎麼排：名稱、初始餘額、即時餘額、操作按鈕。負餘額（信用卡）長什麼樣。
- 首頁的 AccountBalances 摘要跟現有那三張「本月支出 / 收入 / 結餘」統計卡的關係。
  D4 建議放在下方另成一列，但我想看到別的做法再決定。
- 帳戶數為零時的空狀態——後端允許刪到剩零個，但那樣記帳表單會沒有選項可選
  （這條列在 §6 風險表）。

樣式用 apps/web 現有的 token 與元件（Button、TextField、TransactionList 的列樣式、
HomePage 的統計卡），參考 docs/artifacts/design-system.html。金額用 formatAmount 的格式，
只加千分位不做除法。示範資料用「現金」「國泰世華」，不要用真實 email。

決策的部分做成可勾選 + 複製成 prompt，我在頁面上挑完再回來告訴你。
```

---

## 3. Step 提案 — 重構 / 後端

```
用 step-proposal 幫 Slice 1 Step 1 與 Step 2 出一份提案，這兩步都不是 UI：

Step 1 — 把 AuthDialog 的外殼抽成 components/Dialog.tsx（D2）。
我要看到抽出前後的職責界線：哪些留在 AuthDialog、哪些進 Dialog。
特別是「關閉時卸載內容」這個細節——D2 說它是漏掉就會出現「第二次打開還留著上次輸入」
的那種 bug，我想確認抽出後它由誰負責。列出 AuthDialog.test.tsx 現有的哪幾條測試
可以當這次重構的回歸網。

Step 2 — ProtectedRoute 與 location.state.from 的站內路徑限制（D1）。
這是開放轉址漏洞，畫一張圖說明未登入 → 導向 /login → 登入後導回的完整流程，
標出 from 進來的位置與檢查點。把該擋掉的形式列成表格，包含 //evil.com 這種
容易漏掉的雙斜線寫法，每一種都標明檢查後的結果。

兩步都要列出影響檔案（新增 / 修改各是哪些）、驗收方式，以及有沒有需要 Ask first 的事項
（新套件 / 新環境變數 / API 變更）。
```

---

## 4. 機制圖解（臨時，不走 skill）

```
做一頁 HTML 解釋 TanStack Query 在這個專案裡的快取失效鏈，放 docs/artifacts/。

起點是 tasks/phase-2b-slice-1-plan.md 的 D5：新增交易會改變帳戶餘額，但
useCreateTransaction 目前只失效 ['transactions', ledgerId]，沒有失效 ['accounts']，
所以畫面上餘額會停在舊數字直到重整。

我要一張 SVG 圖，畫出目前 features/ 底下所有 query key（transactions、accounts、
ledgers、categories）跟會影響它們的 mutation 之間的關係，把該連而沒連的那條線標出來。

再加一段說明「為什麼這種 bug 特別難抓」——它不會拋錯，只會顯示錯的數字。

我是 Python 背景在學 JS 生態，TanStack Query 的快取模型講詳細一點，
跟後端的「餘額即時計算、不儲存」（phase-2c-accounts.md 決策 2）對照著講會更好懂：
後端保證算出來的一定對，但前端可能拿著一份過期的正確答案。
```

> 這類產出用完即丟。談出來的結論要回寫 Markdown，否則會隨頁面消失。

---

## 5. 重新萃取設計語彙

```
docs/artifacts/design-system.html 過期了，重新萃取一份。

來源是 apps/web/src/styles/global.css 的 token，加上 src 底下所有 *.module.css 的元件樣式。
所有數值逐字照抄，不要順手「優化」——這頁的價值就在於它反映的是真實現況。

一併重新檢查有沒有新的硬寫色值逃出 token 系統（上一版找到四個：TransactionList 的
#15803d 收入綠、FormError 的 #fef2f2、Button 的 #fff、AuthDialog backdrop 的
rgb(0 0 0 / 0.4)），以及字級是不是還沒 token 化。

新增的元件也要納進去（例如 Dialog、ConfirmDialog、AccountList 做出來之後）。
```

> 這個檔是 gitignore 的衍生檔，`global.css` 一改就過期。**不要**改成進版控來解決過期問題——那只會製造第二份真相來源。

---

## 其他值得試的（尚未寫成完整範本）

- **API 破壞性變更影響報告**——階段三的好友 / 借還帳會動到核心資料模型，衝擊面比 2c 的
  `PaymentMethod → Account` 更大。`tasks/phase-2c-todo.md` 的「對外提醒」那一節就是這種報告的
  雛形，用 HTML 做成「一邊是 API 變更、一邊是受影響的前端檔案」的對照會清楚得多。
- **Prisma `onDelete` 行為對照表**——`schema.prisma` 現在有 `Cascade` 與 `Restrict` 混用，
  而且註解特別警告過「選填關聯的預設是 `SetNull`」這個陷阱。做成一張刪除連鎖反應圖會很有用。
- **階段三資料模型的設計探索**——債務物件與雙邊鏡像交易有多種建模方式
  （`專案決策脈絡.md` 提到「借出在結構上就是一種轉帳」的替代路線）。這正是並排比較 schema
  最有價值的場合，但要等該階段的 spec 開始寫才做。
