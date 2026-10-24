# 2k 實作計畫：首頁改版

spec：`docs/specs/phase-2k-home-redesign.md`（決策 300～309、W260～W271、SC-H1～SC-H18）。只改 `apps/web` 與文件，合成一個 PR。

> 核可：開發者 2026-10-24（第二版，含 advisor 兩輪審查的修訂，見 §6）。

## 0. 起點

- spec、本 plan、todo 先開 docs PR 合進 `main`。同一個 PR 更新 `docs/handoff.md`（`stats-2j` 那一列與編號分段）和 `docs/handoff/stats-2j.md`。
- 合併後在 `stats-2j` worktree 從 `origin/main` 開整合分支：`git switch -c feature/phase-2k-home-redesign-impl origin/main`。開完先跑 `pnpm install`。只有協調者寫整合分支。
- 每個 worker 一個 worktree、一條子分支 `feature/2k-<名稱>`，從整合分支開。驗收後協調者 merge 回整合分支。
- 角色：全部是網頁，只派 Codex（`default` 角色）。Codex 用完時不換層，停下來問開發者（`docs/orca-multi-agent.md` §4）。
- **不改 `apps/api`、`packages/shared`、資料模型，不加相依套件**（決策 300）。實作中發現缺 API 參數，停下來問。
- 協調者不改 `apps/web`（10-21 起網頁只交給 Codex）。協調者只寫文件、驗收、整合。
- 沒有新的授權或資料隔離面（spec §6），所以沒有協調者先寫的紅燈測試。協調者驗收時確認 diff 不含 `apps/api`、`packages/shared`。

## 1. 元件與相依

### 1.1 W1：共用失效函式（決策 306，`2k-invalidate`）

只依賴整合分支。

- 新檔 `apps/web/src/lib/invalidate-after-money-write.ts`，匯出 `invalidateAfterMoneyWrite(queryClient)`。
- key 用原始前綴陣列（例如 `['ledger-statistics']`），不從各 feature import 常數。原因：`lib/` 從 `features/` import 會讓相依方向反過來，也容易繞成循環。檔頭註解寫明「改了某個 feature 的 key 前綴，要回來改這裡」，測試把兩邊對起來（見下）。
- 失效的前綴（12 個）：
  - `transactions`（含各帳本的列表）、`transaction`（單筆）、`marked-transactions`
  - `accounts`、`balance-trend`
  - `ledger-statistics`、`statistics-trend`
  - `counterparties`（已涵蓋對象的明細與待詢問對象）、`ledger-groups`
  - `settlement-summary`、`ledger-settlements`、`splits`
- 用整個前綴失效，不限定帳本，也不加 `refetchType: 'all'`。react-query 的預設：至少有一個啟用中的 observer（訂閱這筆 query 的元件，且沒設 `enabled: false`）的 query 算 active，會立即重抓；其餘只標成過期，下次掛載才抓。注意 active 不等於看得見：右側欄收起時表單仍掛著，`PendingCard` 也一直訂閱 `counterparties` 底下的待詢問對象（`use-linking.ts:83`）。所以一次寫入會多打幾個請求，W3 的 SC-H3 測試把實際請求增量記下來，協調者看數字。
- 搬進共用函式的前綴，入口裡原本那一行就刪掉，不保留重疊的舊 invalidate。入口自己特有的 key 照舊留在入口，搬的時候不可漏，例如：`use-splits.ts:22` 的 `debt-proposals`、`use-linking.ts:53-54` 的 `friend-requests` 與 `debt-proposals`、`ledgers`、`['ledger', id]`、`categories`、`members`、`ledger-people`。
- 不改任何 query 的 `staleTime`（spec §7 Never）。

#### 1.1.1 寫入入口矩陣

12 個檔案共 51 個 mutation（會寫入後端的 hook）。判斷規則：

1. 現在的失效清單含上面 12 個前綴之一 → 改呼叫共用函式。
2. 不含，但寫入會改到首頁任何數字或顯示資料（金額、餘額、分類名稱、帳本名稱、對象名稱）→ 也呼叫。
3. 兩者都不是 → 不呼叫，在 PR 描述寫理由。

協調者依現況先填好預設值。worker 逐條對照程式碼，跟預設值不同就在 PR 描述說明，協調者逐條核對。

| 檔案                     | mutation                                                                                                                                                                                      | 預設                        | 理由                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `use-transactions.ts`    | `useCreateTransactionForLedger`、`useUpdateTransaction`、`useDeleteTransaction`                                                                                                               | 呼叫                        | 規則 1。新增也是 AI 確認寫入的路徑                                                   |
| `use-debts.ts`           | `useCreateDebtEntry`、`useUpdateDebtEntry`、`useDeleteDebtEntry`、`useRenameCounterparty`、`useDeleteCounterparty`、`useForgiveCounterparty`、`useUnlinkCounterparty`、`useMergeCounterparty` | 呼叫                        | 規則 1                                                                               |
| `use-debts.ts`           | `useCreateCounterparty`、`useDismissMergePrompt`                                                                                                                                              | 呼叫                        | 規則 1（現在失效 `counterparties`）                                                  |
| `use-splits.ts`          | `useCreateSplit`、`useUpdateSplit`、`useDeleteSplit`                                                                                                                                          | 呼叫，保留 `debt-proposals` | 規則 1                                                                               |
| `use-settlements.ts`     | `useCreateSettlement`、`useUpdateSettlement`、`useDeleteSettlement`、`useSetTransactionAccount`、`useSetSettlementAccount`                                                                    | 呼叫                        | 規則 1。後兩個是補帳戶                                                               |
| `use-linking.ts`         | `useAcceptLinkInvite`、`useAcceptProposal`、`useAcceptInviteLink`                                                                                                                             | 呼叫，保留邀請與提議的 key  | 規則 1（走 `use-linking.ts:53-57` 的共用清單）                                       |
| `use-linking.ts`         | `useDeclineLinkInvite`、`useDeclineProposal`、`useSendLinkInvite`、`useCreateInviteLink`、`useCancelLinkInvite`                                                                               | 不呼叫                      | 只動邀請與提議，不碰金額與名稱                                                       |
| `use-ledger-people.ts`   | `useCreateLedgerPerson`、`useRenameLedgerPerson`、`useDeleteLedgerPerson`                                                                                                                     | 呼叫，保留 `ledger-people`  | 規則 1                                                                               |
| `use-ledger-pointers.ts` | `useSetLedgerPointer`、`useClearLedgerPointer`                                                                                                                                                | 呼叫                        | 規則 1                                                                               |
| `use-members.ts`         | `useRemoveMember`                                                                                                                                                                             | 呼叫，保留成員與帳本 key    | 規則 1（`invalidatePeopleSummaries`）；3k 臨時帳戶                                   |
| `use-members.ts`         | `useAddMember`、`useAddMemberTo`                                                                                                                                                              | 呼叫，保留成員與帳本 key    | 規則 1（`use-members.ts:47-50,70-73` 呼叫 `invalidatePeopleSummaries`）              |
| `use-members.ts`         | `useUpdateMemberRole`                                                                                                                                                                         | 不呼叫，保留成員與帳本 key  | 只失效 `members` 與 `['ledger', id]`；沒有改自己角色的介面（`MemberList.tsx:60-62`） |
| `use-ledgers.ts`         | `useLeaveLedger`                                                                                                                                                                              | 呼叫，保留帳本與成員 key    | 規則 1                                                                               |
| `use-ledgers.ts`         | `useRenameLedger`                                                                                                                                                                             | 呼叫                        | 規則 2：標註列顯示帳本名稱（`HomePage.tsx:439`）                                     |
| `use-ledgers.ts`         | `useArchiveLedger`、`useUnarchiveLedger`、`useDeleteLedger`                                                                                                                                   | 呼叫                        | 規則 2：帳本可見性與標註的帳本狀態需同步                                             |
| `use-ledgers.ts`         | `useCreateLedger`                                                                                                                                                                             | 不呼叫                      | 新帳本沒有交易                                                                       |
| `use-marks.ts`           | `useSetTransactionMark`                                                                                                                                                                       | 呼叫                        | 規則 1                                                                               |
| `use-accounts.ts`        | `useCreateAccount`、`useUpdateAccount`、`useDeleteAccount`                                                                                                                                    | 呼叫                        | 規則 1                                                                               |
| `use-categories.ts`      | `useUpdateCategory`、`useDeleteCategory`                                                                                                                                                      | 呼叫，保留 `categories`     | 規則 2：分類段與交易列顯示分類名稱                                                   |
| `use-categories.ts`      | `useCreateCategory`                                                                                                                                                                           | 不呼叫                      | 新分類沒有交易                                                                       |

#### 1.1.2 測試

- `invalidate-after-money-write.test.ts`：
  - 列出它失效的每個前綴。
  - 每個前綴用對應 hook 真正產生的 query key 驗證會被打中，防止有人改了前綴而這裡沒跟上。要涵蓋：不同帳本、不同期間、`LEDGER` 與 `MINE` 視角、標註 `expanded` 為 `false` 與 `true`。
  - 用真的 `QueryClient`：active 的 query 會重抓、inactive 的只標成 stale、無關的 key（例如 `categories`、`friend-requests`）不受影響。
- 入口測試可以參數化：矩陣裡每個「呼叫」的 mutation 各一條「成功後呼叫了共用函式」，每個「不呼叫」的各一條「沒有呼叫」。保留的自有 key 各斷言一次。
- 另保留一條端到端式的 hook 測試：真的 `QueryClient`、只 mock `fetch`，寫入成功後 `ledger-statistics` 與 `balance-trend` 真的被重抓。
- SC-H3 的「重抓期間舊數字留著」放在 W3 的首頁測試，W1 只負責 hook 層。

### 1.2 W2：首頁卡片元件（W262～W265，`2k-home-cards`）

只依賴整合分支，跟 W1、W4 平行。**純元件**：只吃 props，不打 API，不讀 localStorage。資料由 W3 的 `HomePage` 傳進來。

| 元件                  | 位置                                          | 說明                                                                                                                                                                                                                         |
| --------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssetCard`           | `features/accounts/AssetCard.tsx`             | W262。props：總額的 query 狀態、帳戶的 query 狀態、分類段（`ReactNode`，沒有帳本時不傳）。總額與帳戶各自顯示錯誤                                                                                                             |
| `HomeAccountList`     | `features/accounts/HomeAccountList.tsx`       | W264。先 5 個，「全部 N 個」原地展開。展開後用 container query（依清單本身寬度換版面）判斷 440px 才兩欄，不看視窗寬度。不可用 `AccountList` 這個名字：帳戶頁的管理元件已叫 `AccountList`（`AccountsPage.tsx:10,91`），不動它 |
| `HomeCategorySection` | `features/statistics/HomeCategorySection.tsx` | W263。props：`expenseGroups`、帳本名稱、連到統計頁的網址、`colorOf(group)`。不自己決定顏色，也不算百分比                                                                                                                     |
| `DebtsCard`           | `features/debts/DebtsCard.tsx`                | W265。props：對象的 query 狀態、未指向帳本的 query 狀態、是否顯示「全部 →」                                                                                                                                                  |

- 每個元件的 `.module.css`、`.test.tsx` 用同一個名字（例如 `HomeAccountList.module.css`）。
- `AccountBalances.tsx` 由 `AssetCard`＋`HomeAccountList` 取代。它只有首頁在用，但 W2 不刪它，避免 `HomePage` 在 W3 之前編譯失敗；W3 換上新卡時刪掉它與它的測試，並更新 `ActiveLedgerProvider.tsx:29`、`active-ledger.test.tsx:11` 提到它的註解（spec §9 原本要改它的檔頭，刪檔後改成這兩處）。
- 借還列的頭貼與箭頭用 `features/debts/MiniOweArrow.tsx` 或 `BalanceArrow.tsx`，不另做。
- 金額一律用 `formatMoney`。不加總、不算百分比（spec §7 Never）。
- 元件測試：W262～W265、SC-H5、SC-H7、SC-H8 的內容與互動（0、5、6、12 個、展開、收起、順序、負數與臨時帳戶）、SC-H9 的顯示部分、SC-H10。
- jsdom（測試用的模擬瀏覽器）不算 CSS 版面，量不到寬度。SC-H8 的 439／440px 與右側欄打開的情況改由 W5 在真的瀏覽器量。W2 只斷言 container query 掛在清單本身（class 與 CSS 檔內容），不斷言欄數。

### 1.3 W4：配色設定（決策 309、W271，`2k-color-setting`）

只依賴整合分支，跟 W1、W2 平行。

- 新檔 `app/use-home-category-colors.ts`：
  - 偏好的唯一來源是一個模組層級的 store，用 `useSyncExternalStore`（React 內建，讓多個元件訂閱同一份外部狀態）。設定彈窗與首頁讀同一份，改了立即生效（決策 309 的最後一句）。不加 provider，不做跨分頁同步。
  - store 的要求：`getSnapshot` 回傳穩定的字串；寫入 localStorage 丟例外時仍更新記憶體裡的值並通知訂閱者；取消訂閱時移除 listener；匯出 store factory 或測試用的重置函式，讓每個測試從乾淨狀態開始，不靠測試順序。
  - localStorage key `ledger.homeCategoryColors`，值 `color`／`gold`／`gray`；缺值、非法值、讀寫丟例外都照決策 309 處理。寫法照 `use-theme.ts` 的 `readThemePreference`、`persist`。
  - 匯出純函式 `homeCategoryColor(group, mode, chartTheme)`：彩色呼叫 `getStatisticsGroupColor`；金色時一般分類回 `var(--color-accent)`，固定分組與未分類回 `NEUTRAL_CHART_COLORS[chartTheme]`；灰色全部回中性灰。不改 `chart-colors.ts`。
- 把 `StatsPage.tsx:673` 的 `useChartTheme`、`readChartTheme` 原樣搬到 `features/statistics/charts/use-chart-theme.ts`，`StatsPage` 改 import。只搬不改行為。
- `SettingsDialog.tsx`：「動畫」下面加「首頁分類條配色」一組，三張卡附示意條，做法照「外觀」組（radiogroup、方向鍵、roving tabindex，即只有選中的卡能用 Tab 進入）。示意條的顏色用目前主題代入 `homeCategoryColor` 算出來，不另寫一份色碼。不加說明段。更新檔頭。
- 測試：
  - `use-home-category-colors.test.ts`：缺值、非法值、讀寫丟例外（寫入失敗也通知訂閱者）、兩個訂閱者同時更新、取消訂閱後不再收到通知、`homeCategoryColor` 三種模式乘深淺兩種主題，金色時固定分組與未分類是中性灰。
  - `SettingsDialog.test.tsx`：三張卡、方向鍵切換、只有選中的卡 `tabIndex=0`、切換後 localStorage 有值、示意條顏色跟模式一致、不發任何請求。
  - SC-H18 的統計頁回歸：`StatsPage` 測試加一條，偏好設成金色與灰色時，統計頁的分類顏色跟彩色時完全一樣。
  - `StatsPage` 既有測試全綠。

### 1.4 W3：首頁組裝（W260、W261、W266～W270，決策 307、308，`2k-home-page`）

依賴 W1、W2、W4 都合進整合分支才開工。SC-H3 的首頁測試要 W1 的共用函式才會綠。

- `pages/HomePage.tsx` 版面照 W260：3 張卡 → `PendingCard` →「最近｜標註」與資產趨勢卡並排 →「我的」：`AssetCard` 與 `DebtsCard` 並排。
- 分類段：用 `LedgerStatsRow` 已經在打的同一個 `useLedgerStatistics` 回應，不再多呼叫一次（SC-H4）。把 hook 提到 `Dashboard`，3 張卡與分類段都從它拿。
- 顏色：`colorOf = (group) => homeCategoryColor(group, mode, chartTheme)`，`mode` 來自 W4 的 hook，`chartTheme` 來自 `useChartTheme`。

#### 1.4.1 切帳本不重打（決策 307、SC-H2）

只把 hook 上移不夠。現在 `Dashboard` 用 `key={ledger.id}`（`HomePage.tsx:114-115`），切帳本時整棵重建，底下每個呼叫 `useAccounts` 的元件都重新掛載並重抓。已查證的路徑：

- `PendingCard`（`HomePage.tsx:284`）：`useAccounts`（`PendingCard.tsx:47`）、待詢問對象 `/counterparties?askMerge=true`（`use-linking.ts:83`）、邀請、提議。
- `TransactionWorkbench`（`HomePage.tsx:314`）：右側欄收起時內容不卸載，預設就掛著新增表單，`TransactionForm.tsx:222,619` 呼叫 `useAccounts`。補帳戶與結清時還有 `FillAccountForm.tsx:21`、`SettlementForm.tsx:47`；借還表單 `DebtEntryForm.tsx:73` 等也在同一棵樹。

做法分兩部分：

1. **拿掉 `Dashboard` 的 `key={ledger.id}`。** `PendingCard` 不再隨帳本重建。帳本相關的 query 本來就以 `ledger.id` 當 key，換帳本時自然換資料。需要隨帳本重設的區域狀態改成明確處理：
   - 右側欄目標存成 `{ ledgerId, target }`。只在讀取時比對帳本 id 不夠：A 切到 B 再切回 A，舊的編輯或刪除確認會重新出現。`useState` 的初始化函式（`HomePage.tsx:177-180`）在不重建時也不會再跑。所以要明確寫入：
     - 真正切帳本時，在 render 中比對上一次的 `ledgerId`，不同就 `setState` 清掉舊目標（React 文件「props 變了就調整 state」的做法）。新目標是符合目前帳本的待處理動作，沒有就是新增。
     - 待處理動作（§1.4.2）符合目前帳本時，先寫入 `{ ledgerId, target }`，再清除待處理動作。現在的 pending effect（`HomePage.tsx:229-233`）只 `open()` 和清除，沒有設目標，要補上。
     - 同一本帳本的資料重抓不重設目標，使用者正在輸入的表單不受影響。
     - `useRightPanel` 不另加 close（`RightPanelProvider.tsx:21-27`）。
     - 備選：把 `panelTarget` 和交易操作區抽成保留 `key={ledger.id}` 的小子元件。不是必要做法；採用的話照樣要過 §1.4.4 的測試。
   - 表單的內容狀態跟帳本綁定，所以 `TransactionWorkbench` 裡的表單 `key` 加上 `ledger.id`，換帳本時只重建表單。
   - 標註展開、「最近｜標註」分頁狀態不重設（W270）。
   - **舊帳本的資料不可操作。** `useTransactions` 用 `placeholderData: keepPreviousData`（`use-transactions.ts:53-61`）。拿掉 key 後，切到 B 時 `recent.data` 仍是 A 的交易，`isPlaceholderData` 為 true、`isLoading` 為 false；`HomePage.tsx:185,299-308` 會畫出 A 的列，點下去卻用 B 的帳本。修法：首頁在 `recent.isPlaceholderData` 時把最近交易當成載入中，不畫可操作的舊列。同一本帳本背景重抓時保留舊數字（SC-H3），這兩件事不衝突：背景重抓時 `isPlaceholderData` 是 false。
   - 其他用 `keepPreviousData` 的 hook：`use-debts.ts:76,101`（對象清單、對象明細）、`use-ledgers.ts:199,224`（退出、刪除預覽）、`use-marks.ts:37`（標註）。W3 逐一確認：key 隨帳本變的，首頁不把舊帳本的資料當成可操作內容；標註與對象是跨帳本的個人資料，key 不隨帳本變，不受影響。結果寫進 PR 描述。
2. **表單共用首頁已持有的帳戶資料。** 在 `use-accounts.ts` 加一個 context：`LedgerView` 用自己的 `useAccounts()` 結果提供它；`useAccounts()` 在 context 裡就回傳那份結果，自己的 query 不發請求；不在 context 裡就跟現在一樣。這樣首頁底下所有 `useAccounts` 呼叫端不用改，交易頁、帳戶頁的行為不變。邊界：
   - `useAccounts` 每次都呼叫 `useContext` 與 `useQuery`，`enabled` 設成「沒有 context 提供的結果」，最後回傳 `shared ?? own`。不可以在呼叫 hook 之前 `return`（違反 hook 規則）。
   - `LedgerView` 自己的 `useAccounts()` 在它提供的 context 外呼叫。登入後不論有沒有帳本，兩條顯示分支都一直掛著它。
   - context 提供整個 query 結果，不論 `data` 是否已載入。載入中與錯誤狀態以這份結果為準，context 內那些不發請求的 observer 的 pending 狀態不能蓋過它。
   - invalidate 時，啟用中的那個 observer 會重抓，不發請求的 observer 也會拿到新資料（advisor 已驗證）。
   - 不關全站的 `refetchOnMount`，不改 `staleTime`（決策 306 最後一句）。
   - 檔頭寫明這個 context 只有首頁提供，以及為什麼。
3. 其餘個人資料的 hook 放在 `LedgerView`：`useCounterparties({ nonZero: true, limit: 5 })`、`useLedgerGroups({ unpointed: true })`、`useMarkedTransactions`、`useBalanceTrend`（已在）。資料往下傳。

檔案所有權：W3 擁有 `HomePage.tsx`、`use-accounts.ts` 的 context 部分（W1 已合併，不衝突）、`TransactionWorkbench.tsx` 的表單 `key`。其他表單與 `PendingCard` 不改；若發現某個呼叫端必須改，在 PR 描述列出。

#### 1.4.2 待處理的標註動作（決策 308）

- 現在 `LedgerView` 只存待處理的那一筆交易（`HomePage.tsx:101-110`），`Dashboard` 一律用 `editTargetOf` 初始化（`HomePage.tsx:177-180`）。照搬會把「補帳戶」變成「編輯」。
- 改成存「交易＋動作」：`{ transaction, intent: 'edit' | 'fillAccount' }`，放在 `LedgerView`（不隨帳本變的那一層）。
- `fillAccount` 遇到別本帳本的標註：存 `intent: 'fillAccount'` → 切帳本 → 打開補帳戶表單。表單送出時用標註所屬帳本的 id。做法同 `startEditingMarked`。

#### 1.4.3 其他

- 「最近｜標註」卡（W266、W270）：tablist、方向鍵、只有選中的分頁在 Tab 順序；取消最後一筆標註回到「最近」並移焦點；跨帳本編輯或補帳戶後停在「標註」。分頁狀態放在 `LedgerView`，切帳本後才停得住。
- 資產趨勢卡（W261）：兩欄時高度跟左卡對齊、圖面 180～320px；一欄時不超過 260px。點位與最後一點標籤不裁切。`BalanceTrendChart` 若要加高度參數就加，不改它的資料與互動。
- 沒有帳本、未登入照 W268。
- 刪 `AccountBalances.tsx` 與它的測試，改 `ActiveLedgerProvider.tsx:29`、`active-ledger.test.tsx:11` 的註解。
- 更新 `HomePage.tsx` 檔頭與 `Dashboard` 註解（spec §9）。

#### 1.4.4 測試（`HomePage.test.tsx`）

- SC-H2：
  - 用真的 `QueryClient`，掛真的 `PendingCard` 與 `TransactionWorkbench`（含新增表單），只 mock `fetch`。
  - 初始請求都結束後記下每個端點的次數當基準。切到另一本帳本、等請求結束，下列端點的增量都是 0：`/accounts`、`/accounts/balance-trend`、`/counterparties?nonZero=…`、`/counterparties?askMerge=true`、`/ledger-groups?unpointed=…`、標註列表。
  - 用 URL 的 query 參數區分對象清單與待詢問對象，不能只比對路徑。
  - 帳本相關的端點（統計、最近交易、記帳預設值）照常打新帳本的。
- 帳戶 context：
  - context 內的子元件卸載再掛載，`/accounts` 增量 0。
  - invalidate 後，context 內子元件拿到的是新資料。
  - 第一次載入與錯誤時，context 內子元件看到的是 `LedgerView` 那份結果的狀態，不是自己不發請求的 pending。
- 舊帳本資料不可操作：讓 B 帳本的最近交易回應延遲。回應回來前，A 的列不出現或不能操作；回來後才能操作。同一本帳本背景重抓時，舊列照常顯示（SC-H3）。
- 右側欄目標：
  - A 帳本打開編輯或刪除確認 → 切到 B → 切回 A，舊目標不會出現。
  - 跨帳本的編輯與補帳戶：待處理動作清除、再 rerender 一次之後，表單仍是正確的那一種、資料是那一筆。
  - 同一本帳本重抓時，正在輸入的表單內容不被清掉。
- SC-H3：首頁新增一筆交易後，統計、資產趨勢、帳戶、借還、最近、標註各重抓一次；新回應回來前斷言畫面仍是舊數字。記錄這次寫入的總請求增量，寫進 PR 描述。
- SC-H12：標註來自「家用」、目前在「日常」，按「補帳戶」→ 切到「家用」→ 打開的是補帳戶表單，不是編輯表單 → 送出的請求 URL 帶「家用」的 id。
- SC-H4、SC-H6、SC-H11、SC-H15、SC-H16、SC-H18 的首頁部分（切換配色後分類段立即換色、切帳本不重設）。
- 2j 的 SC-R14、SC-R22 照樣通過（SC-H17）。
- 版面尺寸（SC-H8 寬度、SC-H13 高度）不在這裡測，見 W5。

### 1.5 W5：Web e2e（`2k-web-e2e`）

依賴 W1～W4 都合進整合分支，W3 驗收過。

- 開跑前：確認沒有舊的 API、Vite、preview server 佔著 3100、5273、5274（`e2e/env.ts:18-25`）。`playwright.config.ts` 在非 CI 時 `reuseExistingServer`，會直接用到別人開著的伺服器。也確認沒有別的 worktree 正在跑 Web e2e。
- 新檔 `e2e/home.spec.ts`：
  - SC-H1：桌機與 390px 的區塊順序。
  - SC-H3：在首頁新增一筆支出，3 張卡、分類段、總額、趨勢最後一點、帳戶餘額都更新，不重整。
  - SC-H8 的尺寸：12 個帳戶展開後，清單寬度 439px 時一欄、440px 時兩欄；寬視窗但右側記帳欄打開、卡片變窄時照清單寬度判斷。量 `getBoundingClientRect`。
  - SC-H13：桌機兩欄，最近 0、1、5 筆，標註 2、10 筆、超過 10 筆按「再 N 筆」展開後。每種情況量趨勢卡底邊不低於左卡底邊；圖面量 SVG 本身（`BalanceTrendChart.module.css:18-22` 是 `width:100%; height:auto`，量容器不準），在 180～320px；390px 時不超過 260px。斷言每個點位與最後一點標籤的方框都在 SVG 方框內。
  - SC-H14：390px 淺色與深色，長名稱、大金額、15 類展開、12 個帳戶展開，`scrollWidth` 不大於視窗寬度；展開按鈕與分頁觸控區至少 44px。
  - SC-H18：設定彈窗切到金色、灰色，首頁分類段換色，重整後保留；統計頁顏色不變。
- 既有的 `stats.spec.ts`、`layout.spec.ts`、`smoke.spec.ts` 裡依舊版首頁寫的選擇器跟著改，不刪掉它們驗證的行為。
- 測試資料庫 `ledger_2k_web_e2e_test`，`.env.test` 指向它。

## 2. 實作順序

1. 開發者核可 → docs PR（spec、plan、todo、handoff）→ 合併 → 從 `origin/main` 開整合分支、`pnpm install`。
2. 第 1 波平行：W1、W2、W4（Codex）。
3. 第 2 波：W1、W2、W4 都合併後派 W3。
4. 第 3 波：W3 合併後派 W5。
5. 協調者整體驗收（§4）、spec §9 的文件影響、PR、部署。

## 3. 風險與對策

| 風險                                                           | 對策                                                                                            |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 共用失效函式漏掉某個入口，或某個 feature 改了 key 前綴沒跟上   | §1.1.1 矩陣逐條對應測試；共用函式的測試用真正的 hook key 比對前綴；協調者逐條核對               |
| 搬移時漏掉入口特有的 key                                       | §1.1 列出要保留的 key；入口測試各斷言一次                                                       |
| 失效太廣，一次寫入打出很多請求                                 | 只有 active 的 query 立即重抓；SC-H3 測試記錄實際請求增量，寫進 PR 描述                         |
| 重抓期間閃成 $0 或載入中                                       | 元件以 `data` 是否存在判斷，不看 `isFetching`；SC-H3 測試在新回應回來前斷言舊數字               |
| 切帳本仍重打個人資料                                           | 拿掉 `Dashboard` 的 key＋帳戶 context（§1.4.1）；SC-H2 用真的 `QueryClient` 與真的子元件量增量  |
| 拿掉 key 後某個區域狀態沒跟著帳本重設                          | 表單 `key` 加帳本 id；切帳本時在 render 中清掉舊目標；A→B→A 的測試；協調者逐行看 `HomePage.tsx` |
| 切帳本時畫出上一本帳本的最近交易，點下去用錯帳本               | `isPlaceholderData` 時當成載入中；B 回應延遲的測試；其他 `keepPreviousData` 的 hook 逐一確認    |
| 帳戶 context 的載入或錯誤狀態不對                              | hook 一律呼叫、owner 常駐在 context 外；卸載再掛載、invalidate、首次載入與錯誤各一條測試        |
| 帳戶 context 影響到首頁以外的頁面                              | 只有 `LedgerView` 提供；不在 context 裡時行為不變；交易頁、帳戶頁既有測試全綠                   |
| 分類段多打一次統計                                             | 分類段與 3 張卡共用 `Dashboard` 的同一個 hook；SC-H4 計算呼叫次數                               |
| 跨帳本補帳戶變成編輯，或送到目前帳本                           | 待處理動作存 `intent`；SC-H12 斷言打開的是補帳戶表單、請求 URL 帶原帳本 id                      |
| 設定彈窗與首頁的配色不同步                                     | 單一 store＋`useSyncExternalStore`；測試兩個訂閱者同時更新；W5 在真的瀏覽器切一次               |
| 配色 store 的測試互相污染                                      | store factory 或重置函式，每個測試重置                                                          |
| 搬 `useChartTheme` 或配色設定改壞統計頁                        | 只搬不改；`StatsPage` 加金色、灰色不影響的斷言；`stats.spec.ts` 全綠                            |
| 趨勢卡高度在不同內容量下忽高忽低，或圖被裁切                   | W5 在真的瀏覽器量多種內容量，量 SVG 本身與點位方框；協調者看截圖                                |
| 帳戶清單展開後的兩欄判斷看視窗寬度，右側欄打開時卡片變窄就擠壞 | 用 container query；W5 量右側欄打開的情況                                                       |
| 390px 橫向捲動                                                 | W5 斷言 `scrollWidth`；協調者看淺色與深色截圖                                                   |
| e2e 連到別人開著的伺服器                                       | W5 開跑前確認 3 個埠沒有被佔                                                                    |
| W1 與 W3 都動到 `use-accounts.ts`                              | W3 在 W1 合併後才開工                                                                           |
| W2、W3 與 2j 的首頁元件測試衝突                                | 2j 的首頁測試由 W3 跟著新版面改寫，保留它們驗證的行為（spec §6）                                |
| 額度用完                                                       | 網頁不換層，停下來問開發者（`docs/orca-multi-agent.md` §4）                                     |

## 4. 驗證點

- 每個 worker：`pnpm --filter @ledger/web lint / typecheck / test`，`pnpm format:check`。
- 協調者：
  - 確認整個 diff 沒有 `apps/api`、`packages/shared`、`package.json` 相依的改動。
  - 逐行看共用失效函式、§1.1.1 矩陣每一條、`HomePage.tsx` 的 hook 位置與拿掉 key 後的狀態處理、帳戶 context、決策 308 的流程、配色 store。
  - 自己重跑 SC-H2、SC-H3 的測試，看請求增量的數字。
  - 跑 `pnpm lint / typecheck / test / build / format:check` 與兩套 e2e。
  - 用 Playwright 截 390px 與 1280px，淺色與深色，彩色、金色、灰色，逐項對 W260～W271。
- 部署後（dev）：
  - 首頁版面、展開、分頁切換各點一次。
  - 切一次配色、重整一次。
  - 只讀，不在 dev 建資料。SC-H3 已由 e2e 驗證。

## 5. 派工

| 波次 | worker             | 範圍 | 驗收                                                                                                     |
| ---- | ------------------ | ---- | -------------------------------------------------------------------------------------------------------- |
| 1    | `2k-invalidate`    | §1.1 | §1.1.2 的測試；PR 描述附矩陣，跟預設值不同的逐條說明；Web 檢查全綠                                       |
| 1    | `2k-home-cards`    | §1.2 | W262～W265、SC-H5、H7、H8 內容與互動、H9 顯示部分、H10 的元件測試；元件不打 API；Web 檢查全綠            |
| 1    | `2k-color-setting` | §1.3 | 配色 store 與 `homeCategoryColor` 的單元測試；設定彈窗測試；統計頁金色、灰色不受影響的斷言；Web 檢查全綠 |
| 2    | `2k-home-page`     | §1.4 | SC-H2（增量 0）、H3（附請求增量）、H4、H6、H11、H12、H15～H17、H18 首頁部分的元件測試；Web 檢查全綠      |
| 3    | `2k-web-e2e`       | §1.5 | `home.spec.ts` 涵蓋 SC-H1、H3、H8 尺寸、H13、H14、H18；兩套 Web e2e 全綠                                 |

- 全部是 Codex。第 1 波同時 3 個 Codex worker。
- 三個第 1 波 worker 的檔案不重疊：W1 只在 `lib/` 與 12 個 `use-*.ts`；W2 只建新元件；W4 只在 `app/`、`SettingsDialog`、`StatsPage` 與新的 `use-chart-theme.ts`。
- worker 的新 worktree 第一件事跑 `pnpm install`。
- 只有 W5 碰資料庫，用 `ledger_2k_web_e2e_test`。
- 做完的 worker 驗收合併後，立刻 `worker-release`，再清 worktree、子分支、終端機、worker 測試資料庫。

## 6. 實作紀錄

- 2026-10-24 advisor（Codex）審 plan 第一版，6 項必改、2 項建議全部採納：
  1. 首頁帳戶清單改名 `HomeAccountList`，帳戶頁的 `AccountList` 不動。
  2. 切帳本不重打：只上移 hook 不夠，`Dashboard` 的 key 會讓 `PendingCard` 與表單重建。改成拿掉 key＋帳戶 context（§1.4.1）。SC-H2 改成「切換前後增量 0」，用真的 `QueryClient` 與真的子元件量。
  3. 不呼叫共用函式的標準改成「不影響任何首頁數字或顯示資料」；分類改名、帳本改名都要呼叫。
  4. 「12 個入口」是 12 個檔案、51 個 mutation，加上 §1.1.1 矩陣。
  5. jsdom 量不到版面：SC-H8 尺寸改由 W5 量；SC-H13 加標註超過 10 筆展開、量 SVG 本身與點位方框；W4 加統計頁不受配色影響的斷言。
  6. W3 改成依賴 W1、W2、W4。
  - 建議：待處理的標註動作存 `intent`（§1.4.2）；W5 開跑前確認埠沒被佔（§1.5）。
  - 測試策略的配置跟 spec §6 有一處不同：SC-H8 的寬度從元件測試移到 e2e。spec §6 同步改。
- 2026-10-24 advisor 審 plan 第二版，4 項全部採納：
  1. 拿掉 key 後，`keepPreviousData` 會讓切帳本時畫出上一本帳本的最近交易，點下去卻用新帳本。首頁在 `isPlaceholderData` 時當成載入中；其他用 `keepPreviousData` 的 hook 由 W3 逐一確認（§1.4.1）。
  2. 右側欄目標的重設寫清楚：切帳本時在 render 中清掉舊目標，待處理動作先寫入目標再清除，同帳本重抓不重設（§1.4.1）。
  3. 帳戶 context 的邊界：hook 一律呼叫、`LedgerView` 在 context 外呼叫並常駐、提供整個 query 結果、載入與錯誤以 owner 為準；§1.1 的 active 定義改成「至少一個啟用中的 observer」（§1.1、§1.4.1、§1.4.4）。
  4. 矩陣：`useAddMember`、`useAddMemberTo` 呼叫；`useUpdateMemberRole` 不呼叫；封存與取消封存的理由改成「帳本可見性與標註的帳本狀態需同步」。
- 2026-10-24 W5 截圖驗收發現 5 件產品問題，另派 W6（Codex）修：
  1. 一欄時趨勢卡保留 16rem 最小高度，但 SVG 依 viewBox 比例只有約 111px 高，下面空 130px。
  2. SVG 依 viewBox 等比縮放，標籤字跟著縮：1280px 約 9px，390px 約 7px，違反 W269「可讀」。兩欄時圖面還會上下留白（640:230 的比例放進 214～320px 高的框）。改成量實際寬高、viewBox 用實際像素，字維持 14px／11px。這在 W261「沿用畫法」的範圍內。
  3. 兩個「資產」標題 → 決策 310（開發者核可，advisor 同意）。
  4. 「最近」分頁內重複的「最近交易」→ 決策 311。
  5. 390px 名稱截斷、列多縮排 16px（3d 既有行為）→ 決策 312。
  - advisor 指出 `BalanceTrendChart` 只有首頁用，統計頁用的是 `TrendLineChart`，改它不影響統計頁。
- 2026-10-24 W6 驗收：5 件問題都修好（我重跑 lint、typecheck、format:check 全綠，122 檔 994 個測試通過，Web e2e 88 passed）。390px 截圖還有 2 件，都在核可範圍內，同一個 worktree 追加 W7（Codex）：
  1. 最後一點的金額與月份標籤壓到最後一段折線。2j 原本把金額放左上、月份放左邊同高；W6 字變大後更明顯。改成兩個標籤疊在一起，放在最後一段折線的另一側，仍不可被裁切（W261）。
  2. `.dataCard` 的 `min-height: 16rem`（W3 加的，spec 沒要求）讓一欄時只有 2 列的「最近」卡多出約 80px 空白。一欄時拿掉，兩欄維持。
- 2026-10-24 W7 驗收：第一版的標籤擺放函式放不下時會 throw，render 中丟錯會讓首頁白屏，退回改成夾在邊界內（696dcf3）。我重跑 lint、typecheck、format:check 全綠，122 檔 1000 個測試通過，Web e2e 89 passed（3.4m）。實測：最後一段折線與標籤最短距離桌機 9.60px、390px 9px；390px 最近卡列底空白 25px；1280px 卡高 256px。W6／W7 合併進整合分支 351a1b8。
- 2026-10-24 D1 整體驗收（程式 commit 1e203e0）：
  - diff 沒有改到 `apps/api`、`packages/shared`、`package.json`、`pnpm-lock.yaml`、`.github`。68 個檔，+5713／−1427。
  - 協調者重跑：shared build、lint、typecheck、format:check、build 全部 exit 0；單元測試 API 828 個、Web 122 檔 1000 個通過；API e2e 52 個 suite、520 個通過；Web e2e 89 passed（3.6m）。
  - SC-H2、SC-H3 在 `HomePage.test.tsx`：切帳本前後個人端點請求增量 0；新增一筆交易後請求增量 9（POST 1 加 8 個首頁端點各重抓 1 次），重抓期間舊數字留著。
  - 截圖（W7 重產的 12 張，390px 與 1280px × 淺色與深色 × 三種配色）抽看 light-color-390、dark-gold-1280、light-gray-1280、dark-gray-390，對過 W260～W269、W271 的版面與配色。
  - spec §9 文件影響：2j W215 與 SC-R18 加註被取代；`docs/README.md` 標 2k 已完成；`CLAUDE.md` §4、`docs/handoff.md`、`docs/handoff/stats-2j.md` 更新。各寫入入口的註解已指向 `invalidateAfterMoneyWrite`。
  - 測試資料庫 `ledger_2k_*` 都已刪除，只剩 `ledger_stats_test`。
