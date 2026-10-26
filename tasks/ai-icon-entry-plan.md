# 實作計畫：AI 記帳入口改成圖示，首頁也能用

spec：[`docs/specs/phase-4a-ai-text.md`](../docs/specs/phase-4a-ai-text.md) §2.4（W246～W256）、SC-P28～P32；[`docs/specs/phase-2i-web-layout-v2.md`](../docs/specs/phase-2i-web-layout-v2.md) SC-38 的現況註記。
todo：[`tasks/ai-icon-entry-todo.md`](ai-icon-entry-todo.md)。

## 0. 起點

- `main` 在 `1df1276`（Node 24.22.1）。
- spec 修訂在分支 `docs/ai-icon-entry-spec`（ai-4a worktree），核可後走 docs PR。
- 實作在 worktree `ai-icon`，分支 `feature/ai-icon-entry`，目前在 `1df1276`、沒有自己的 commit。
- 只動 `apps/web`。不改 API、不改資料模型、不加套件、不改 CI。
- 開發者 2026-10-26 已定：圖示 1 號（星芒）、B 案（向左展開，有動畫）、首頁承接用丁案、圖示狀態表。視覺參考是 ai-icon worktree 的 `docs/artifacts/step-ai-icon-entry-preview.html`（不進版控）。

## 1. 決策經過

### 1.1 首頁怎麼承接（advisor 第 1 輪）

協調者提了 3 個做法，advisor 另提丁案，開發者選丁案。

| 做法   | 內容                                               | 不選的原因（使用者會遇到的情境）                                                                 |
| ------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 甲     | 首頁自己持有草稿，兩頁各自獨立                     | 首頁解析出 3 筆，點「查看全部」去交易頁核對，回首頁 3 筆全沒了；解析中換頁，額度扣了卻拿不到結果 |
| 乙     | 草稿共用，首頁送出後自動導到交易頁                 | 送出後繼續看統計，較慢的回應突然把人帶走                                                         |
| 丙     | 首頁圖示只是捷徑，點了跳交易頁                     | 同一個圖示在兩頁行為不同；首頁想快速記一筆也被帶走                                               |
| **丁** | 兩頁都在原頁送出、編輯、確認；草稿放在路由外層共用 | 採用。代價是 W214「離開交易頁就消失」要改                                                        |

advisor 第 1 輪另外指出的事，都已寫進 spec：

- 草稿歸屬看每筆的 `draft.ledgerId`，不是送出當下的帳本（W251）。
- 首頁切帳本不重建頁面，交易頁有 `key={ledger.id}`。兩頁各複製一份狀態，切帳本的行為會不一致（W250）。
- 錯誤原本在 portal 外，改到輸入欄下方要改結構與測試（§6）。
- 收起後才出錯的情況原本沒有定義（W248 (d)）。

### 1.2 協調者修正的 3 點（advisor 第 2 輪全部接受）

1. **誰改 `HomePage.tsx`**：advisor 原本建議由 2l session 當唯一擁有者。協調者認為等 2l 的 PR2、PR3 會把 AI 卡在別人的排程上，而首頁只要改約 20 行。advisor 接受，並列出語意衝突的風險（見 §4 第 1 項）。
2. **2l spec 誰改**：advisor 原本建議這次一起改 2l 的 W272。協調者認為 2l spec 正在由另一個 session 維護。advisor 接受：4a spec 自己寫清楚界線（W252、W256），「拖曳中收到 AI 結果」交給 2l 的 PR3。
3. **檢視者的提示文字**：協調者依「介面文字極簡」改成「只能檢視」。advisor 接受，並建議讀屏名稱保留功能名，成為「AI 記帳：只能檢視」。

advisor 第 2 輪補充的並行規則（解析鎖與寫入鎖分開、候選名單固定、登出後停止）寫進 W254。

### 1.3 協調者推導、開發者沒有逐條確認的細節

下面幾點是從已定的規則推導出來的。送審時請開發者一併看：

- W249：錯誤「浮在」輸入欄下方，不撐高橫條。開發者定的是「錯誤放在輸入欄下方」與「橫條高度不變」，兩條合起來只能用浮層。
- W253：借還檢視的提示只有一行字，不加「回到明細」按鈕（介面文字極簡）。
- W251：不能寫入的草稿，✓ 停用、「全部確認」跳過。點它不開記帳表單，只能按 ×，避免表單去查詢已經沒有權限的帳本分類。
- W246：動畫跟著設定裡的「動畫」開關，不看作業系統的「減少動態效果」。這是 2i SC-39 的既有規則，advisor 寫的「支援 reduced motion」以這條為準。

## 2. 元件與相依

所有檔案都在 `apps/web/src`。

### 2.1 共用 AI 狀態（`features/ai/ai-session.tsx`，新）

- 一個 Provider（React 的狀態容器元件）加一個 hook。掛在 `App.tsx` 的 `AppProviders` 裡、路由外面，要拿得到登入狀態與 React Query。
- 持有：解析中狀態、原句、錯誤、草稿清單（每筆有 key、draft、錯誤）、寫入鎖、寫入中的草稿 key、全部確認進行中的旗標、使用者 id、世代號碼。
- 提供的動作：
  - `parse(text, ledgerId)`：同步檢查並取得解析鎖，才呼叫 `useAiParse`。回應到達時比對使用者 id 與世代，不符就丟掉。
  - `confirmDraft(key)`、`confirmAll(excludeKey)`、`discardDraft(key)`。
  - 給記帳表單用的 `markDraftSaving(key, saving)`、`removeSavedDraft(key)`。
- 登出或換使用者：世代加 1，清空全部狀態；進行中的全部確認在下一筆之前檢查世代，不符就停。
- 現有 `AiDraftInput` 的 `submitting` ref、`useAiParse` 的 `isPending`、`TransactionsPage` 的 `aiDrafts`、`busyDraftKeys`、`confirmingAllRef` 都搬進來。
- 寫入沿用 `useCreateTransactionForLedger`，成功後的快取更新照 `invalidate-after-money-write.ts`（W255）。

### 2.2 圖示入口（`features/ai/AiEntry.tsx`，取代 `AiDraftInput.tsx`）

- 用 `usePageToolbarSlot` 拿到橫條節點，portal 過去，靠右。
- 星芒圖示加進 `components/icon-paths.tsx`。
- 自己持有「有沒有展開」（各頁自己的狀態，W250）。
- 依 W247 決定隱藏或停用。props 帶目前帳本與「目前檢視可不可以用」。
- 錯誤浮層、live region、焦點移動、Esc 都在這個元件裡（W248、W249）。
- 樣式改 `AiDraftInput.module.css`（改名跟著元件）與 `PageToolbar.module.css`（靠右）。不改 `PageToolbarSlotProvider`。

### 2.3 草稿區（`features/ai/AiDraftSection.tsx`，新）

- 包住現有的 `AiDraftList`，接共用狀態。兩頁共用同一個元件。
- 照 W251 判斷每筆能不能寫入：用帳本清單與 `isLedgerWritable`。

### 2.4 交易頁（`pages/TransactionsPage.tsx`）

- 拿掉頁面裡的 AI 狀態與函式（約 192～361 行），改用共用狀態。
- 明細檢視：入口照常，草稿區位置照 W209。
- 借還檢視：入口隱藏，顯示 W253 的一行提示。
- 記帳表單的草稿回呼改接共用狀態。共用狀態放在 `key={ledger.id}` 之外。

### 2.5 首頁（`pages/HomePage.tsx`，約 20 行）

- Dashboard 掛 `<AiEntry>`（portal 到橫條）。
- PageHeader 之後、`HomeLayoutRenderer` 之前放 `<AiDraftSection>`。
- `TransactionWorkbench` 補上 `onDraftSaved`、`onDraftSavingChange`；點草稿把 panel 目標設成 `{ kind: 'draft' }` 並打開右側欄。
- 沒有帳本的分支不掛入口。

### 2.6 測試

- 元件與單元測試（Vitest）：
  - 共用狀態：清除時機、世代號碼、解析鎖、寫入鎖、全部確認的候選名單、登出後停止。
  - 圖示入口：W247 的 3 種狀態、W248 (a)～(e)、錯誤位置。改寫 `AiDraftInput.test.tsx`（含第 78 行「alert 不在插槽內」的斷言）。
  - 草稿區：W251 不能寫入的草稿。
- Web e2e（Playwright，假 provider）：SC-P28～P31，§1 第 1～4 步在首頁再跑一次。
- 手動：SC-P32，由協調者用瀏覽器看。

## 3. 實作順序

1. T0（協調者）：本 spec、plan、todo 送審，核可後開 docs PR 合併。通知 stats-2j session 首頁的接點（§6）。
2. T1（Codex `default`）：§2.1～§2.5 與元件測試。
3. T2（Codex `default`，同一個 worker 接著做）：Web e2e。
4. T3（協調者）：驗收。逐行看 diff，重跑全部檢查與兩套 e2e，手動驗 SC-P32。
5. T4（協調者）：PR、部署 dev、清理、handoff。

沒有後端，也沒有授權與資料隔離的伺服器端改動，所以沒有「協調者先寫、先紅」的測試。前端的使用者隔離（SC-P29 第 3 項）屬於網頁程式，照 CLAUDE.md §11 交給 Codex 寫，協調者驗收時特別看這條。

## 4. 風險與對策

1. **和 2l 的語意衝突**（advisor 第 2 輪）：git 合併成功，行為也可能壞掉。例如 2l PR3 用 `inert` 包住整個 dashboard，連 AI 區也鎖住；重寫記帳表單時漏掉草稿回呼；加了 ledger key 讓草稿退回頁面生命週期。
   對策：W256 寫清楚 3 條界線，動工前通知 stats-2j。後合併的一方跑「首頁整合驗收」：編輯版面時 AI 區仍能操作、表單儲存後草稿移除、切帳本與換頁不丟草稿（SC-P29 第 1、5 項）。
2. **全部確認把新到的草稿也寫進去**：解析與寫入可以同時進行，迴圈如果每次讀最新清單，就會寫入使用者還沒看過的草稿。
   對策：開始時固定候選名單（W254 (e)），SC-P30 第 3 項驗證。
3. **登出後還在寫入**：全部確認是一個 async 迴圈，元件卸載不會讓它停。
   對策：每送下一筆前比對世代號碼（W254 (f)），SC-P30 第 4 項驗證。已送出的那一筆不保證撤回。
4. **舊使用者的回應落到新使用者畫面**：對策是回應到達時比對使用者 id 與世代（W250），SC-P29 第 3 項驗證。
5. **頁面卸載時寫入鎖被提早放開**：表單的 POST 已送出，使用者換頁，鎖如果跟著元件卸載就放開，✓ 可能重複寫入同一筆。
   對策：寫入鎖放在共用狀態，以請求結束為準（W254 (c)），SC-P30 第 2 項驗證。
6. **浮層被 sticky 橫條的 `backdrop-filter` 蓋住或裁掉**：`backdrop-filter` 會建立新的堆疊層。對策：SC-P32 手動看，必要時調 `z-index` 或改浮層的掛載位置。
7. **手機虛擬鍵盤蓋住輸入欄**：對策：SC-P32 在手機寬度實際點開輸入欄看。
8. **e2e 撞資料庫**：同時只有一個 worktree 跑 Web e2e（port 3100／5273）。派工時寫明，跑之前先確認其他 worktree 沒在跑。

## 5. 驗證點

- T1 完成：`pnpm --filter @ledger/web lint`、`typecheck`、`test` 全綠；W246～W254 的元件測試都在。
- T2 完成：Web e2e 全綠，含 SC-P28～P31。
- T3：協調者自己重跑 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm format:check`、`pnpm build`、兩套 e2e，填實際數字；SC-P32 逐項記結果。
- T4：CI 全綠、squash merge；dev 部署後開發者按 `Ctrl + Shift + R` 看得到新入口。

## 6. 給 stats-2j session 的通知（T0 核可後送）

- 本修訂會改 `HomePage.tsx` 的 3 個地方：Dashboard 掛 `<AiEntry>`、PageHeader 之後放 `<AiDraftSection>`、`TransactionWorkbench` 補 2 個草稿回呼。
- 請 2l 守住 W256 的 3 條：`inert` 不包 AI 草稿區；保留 2 個草稿回呼；首頁不加會重建共用狀態的 `key`。
- 請 2l 在 PR3 的 spec 或 todo 加一條驗收：「拖曳或調整卡片時 AI 結果到達，草稿區長高後落點仍正確」。做法由 2l 決定。
- 誰後合併誰解衝突，並跑 §4 第 1 項的首頁整合驗收。

## 7. 派工

- T1、T2：Codex `default`，在 ai-icon worktree，同一個 worker 依序做。先跑 `pnpm install`（worktree 已裝過，換 Node 後也已重裝，仍照規則確認一次）。
- Task spec 要寫明：只改 `apps/web`；不改 `PageToolbarSlotProvider` 的責任；介面文字只用 spec 列的字；e2e 跑之前問協調者；不 commit 到別的分支。
- 驗收：協調者逐行看 diff，特別看共用狀態的鎖與世代判斷。

## 8. 實作紀錄

（動工後填寫。）
