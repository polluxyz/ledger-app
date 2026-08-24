# 任務清單：階段二 (2b) Slice 2 — 帳本與成員（前端）

> 狀態：**已核可**（2026-08-23）
> 依據：`docs/specs/phase-2-web-mvp.md`、`tasks/phase-2b-slice-2-plan.md`（Plan 已核可）。
> 用法：依序執行；每個任務有驗收條件。勾選＝「開發者已驗收」。
> 通用驗收（每任務皆適用，不再重複）：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
> 分支：Step 0～2 於 `feature/ledgers-ui`（已合併，PR #26）；Step 3 之後於 `feature/ledgers-ui-slice2`。**本切片不改後端。**

### 設計決策（已於 Plan §4 核可，實作時一律照此）

| #   | 結論                                                                                    |
| --- | --------------------------------------------------------------------------------------- |
| D1  | 作用中帳本用 context + `localStorage`；`/ledgers/:id` 另有自己的網址。存的 id 必須驗證  |
| D2  | 成員管理放明細頁，不放彈窗                                                              |
| D3  | 封存不可逆，**接受**。封存前打字輸入帳本名稱；解除封存延後（記於 2c spec §8）           |
| D4  | 刪除帳本要打字輸入名稱——這是後端 `?confirm=` 契約要求，不是選擇                         |
| D5  | 連動設定用兩顆 radio，預設連動；下方註明建立後不可更改                                  |
| D6  | `TransactionForm` 改收整個 `ledger` 物件，依 `tracksBalance` 決定帳戶欄位               |
| D7  | 非 owner 隱藏管理操作。**這是體驗不是授權**，真正防線在後端                             |
| D8  | 封存帳本不可設為作用中；切換器只列未封存的                                              |
| D9  | 現有 query key 已帶 `ledgerId`，切換自然重取。只需補 `['ledgers']` 與 `['members', id]` |

### 2026-08-23 需求變更：私人 / 共享帳本

開發者在 Step 2 完成後提出：建立帳本時就要選「私人」或「共享」，而不是先建帳本、
要共享再把人加進來。

**定案的規則**：

1. 建立時二選一，**建立後不可互轉**。
2. 私人帳本不能加成員。想改成共享請另建一本帳本。
3. 共享帳本移除成員到只剩自己，它仍然是共享帳本。
4. 要把舊帳本的交易帶過去，靠「複製交易到其他帳本」——**該功能尚未存在**，
   在它做出來之前這種情況無解。這是本決議已知且接受的代價。
5. 加成員只認已註冊的使用者（現況）。真正的「好友清單」是階段三。

**影響**：規則 2 與 3 讓「用成員數推導私人 / 共享」失效——共享帳本可能只有一個
成員。因此帳本需要一個建立後不可變更的欄位，屬**資料模型變更**，另立後端小步 2d
（`docs/specs/phase-2d-ledger-kind.md`）。

本切片的 Step 3 與 Step 6 因此改動並延後，其餘各步不受影響。

---

## Step 0：分支與既有修正

- [x] **0.1 開分支並帶入 Slice 1 的勾選修正**
  - 內容：自 `main` 開 `feature/ledgers-ui`。工作區已有 `docs/specs/phase-2-web-mvp.md:185` 的修正（Slice 1 打勾、刪掉「調初始餘額」），連同本切片的 plan 與 todo 一起做第一個 commit。
  - 驗收：`git status` 乾淨；`main` 未被動到。

## Step 1：資料層

- [x] **1.1 `use-ledgers.ts` 補四個 mutation**
  - 內容：`useCreateLedger`（`POST /ledgers`，帶 `name` 與 `tracksBalance`）、`useRenameLedger`（`PATCH`，**只送 `name`**）、`useArchiveLedger`（`POST /ledgers/:id/archive`）、`useDeleteLedger`（`DELETE /ledgers/:id?confirm=<name>`）。成功後失效 `['ledgers']`。
  - 補充：query key 抽成 `LEDGERS_KEY` 常數匯出，比照 `ACCOUNTS_KEY`。
  - 注意：`useLedgers` 要能帶 `includeArchived`，key 必須包含它（`['ledgers', includeArchived]`），否則兩份清單會互相覆蓋。
  - 驗收：型別綠；`DELETE` 回 204 時不解析 JSON。
- [x] **1.2 `use-members.ts` 新增**
  - 內容：`useMembers(ledgerId)`（`GET /ledgers/:id/members`，key `['members', ledgerId]`）、`useAddMember`、`useUpdateMemberRole`、`useRemoveMember`。三個 mutation 成功後失效 `['members', ledgerId]`；移除自己時要一併失效 `['ledgers']`（帳本會從清單消失）。
  - 驗收：型別綠。
  - 本步刻意**不寫測試**：尚無呼叫者，測它們等於測 react-query。真正的驗證在 Step 6。

## Step 2：作用中帳本

- [x] **2.1 `ActiveLedgerProvider`**
  - 內容：context 提供 `{ ledger, ledgerId, setLedgerId, ledgers, isLoading, error }`。id 存 `localStorage`（key 例如 `ledger-app.activeLedgerId`）。
  - **核心規則**：存的 id 一律要與 `/ledgers` 的結果對照。對不上（被刪、被移出成員、已封存）就退回**第一本未封存的帳本**，並把 `localStorage` 更新成新值。
  - 驗收：測試四種情形——存的 id 有效則採用；id 不存在則退回第一本；id 指向已封存帳本則退回第一本；`localStorage` 是空的則取第一本。
- [x] **2.2 掛進 Providers 並改寫 `HomePage`**
  - 內容：`useCurrentLedger()` 的「固定取第一本」邏輯移除，改由 context 提供。`HomePage` 的 `LedgerView` 改用 context。
  - 驗收：既有的 HomePage / TransactionForm 測試全綠（行為不變，只換來源）。
  - 實作註記（2026-08-23）：作用中帳本改成**當場算出來**，不存第二份 state。原案用
    effect 把「退回第一本」的結果寫回 state，被 ESLint 的 `react-hooks/set-state-in-effect`
    擋下（會多一輪渲染）。改法順帶讓登出與換人登入都不必特別處理——清單一變，答案就跟著變。
    effect 只負責寫 `localStorage`。實際 key 是 `ledger.activeLedgerId`，比照 `ledger.accessToken`。
    測試共 6 條（多了「清單為空不覆寫既有偏好」與「未登入不發請求」）。

> **2d 已於 2026-08-23 合併（PR #27）**，Step 3 與 Step 6 解除封鎖。建立表單因此多一組
> 「私人 / 共享」單選鈕，並在選共享時展開參與者欄位（決議見 plan D10）。

## Step 3：帳本列表與建立

- [x] **3.1 `LedgerList` + `LedgersPage`**
  - 內容：每列顯示名稱、**帳本類型（私人 / 共享）**、我的角色、是否連動、封存狀態；點名稱進明細頁。共享帳本另顯示成員數。列表頂端一個「顯示已封存」的 checkbox（對應 `includeArchived`）。載入中／錯誤／空狀態各有呈現。
  - **不做分組**（私人一區、共享一區）。帳本數量現階段個位數，分組只會把畫面切碎——與 2c 對帳戶分組的判斷一致。
  - 驗收：測試——勾選「顯示已封存」後會用 `includeArchived=true` 重新請求；封存帳本有明確標示；私人與共享各有可辨識的標籤。
  - **未做：成員數（2026-08-23）**。`LedgerSummary` 沒有成員數，只有 `LedgerDetail` 帶完整成員清單。前端要顯示就得對每一本帳本各打一次 `GET /ledgers/{id}`，是 N+1 請求。要做的話得在後端替 `LedgerSummary` 加一個 `memberCount`，屬 API 變更，本步不動。成員數在 Step 5 的明細頁看得到。
- [x] **3.2 `LedgerDialog`（建立）**
  - 內容：以 `Dialog` 承載。由上到下：名稱 → **帳本類型（radio，預設私人）** → 選共享才展開的參與者區塊 → 連動設定（radio，預設連動）。兩組 radio 下方各一行灰字：「建立後不可更改」。
  - 驗收：測試——建立成功後彈窗關閉且新帳本出現在列表；radio 預設選中「私人」與「與我的帳戶連動」；送出的 body 確實帶 `kind` 與 `tracksBalance`；選私人時參與者區塊不出現。
- [x] **3.3 `LedgerParticipants` + `MemberFields`（D10）**
  - 內容：`MemberFields` 是一列的 email 與角色（角色只給 `EDITOR` / `VIEWER`）；`LedgerParticipants` 擁有整份清單與增減列。email 欄位旁註明「對方需要已註冊；還沒註冊的話可以先建立帳本，之後再加」。
  - **送出流程**：先 `POST /ledgers`，再逐筆 `POST .../members`。全部成功才關閉彈窗；有失敗則**帳本照建、彈窗留著**，就地顯示失敗的那幾筆與原因，可改了重試，成功的不重送。**前端不做補償刪除。**
  - 驗收：測試四條——共享但一位都沒填時只送一個 `POST /ledgers`；兩位參與者其中一位 `USER_NOT_FOUND` 時帳本已建立、另一位已加入、彈窗留著顯示錯誤；修正 email 後重試只重送失敗的那筆；角色下拉沒有 `OWNER` 選項。
- [x] **3.4 路由接上**
  - 內容：`/ledgers` 掛進 `ProtectedRoute` 之下。
  - 驗收：未登入開 `/ledgers` 被導向 `/login`，登入後回到 `/ledgers`。頁首導覽一併加上「帳本」連結。

## Step 4：帳本切換器

- [x] **4.1 `LedgerSwitcher` 放進 `AppHeader`**
  - 內容：下拉選單，**只列未封存的帳本**（D8）。選了就 `setActiveLedgerId`。
  - 偏離（2026-08-23）：**下拉裡不放「管理帳本」選項**。Step 3 已在頁首導覽加了「帳本」連結，再放一次是重複；而且那會讓同一個選單同時做「切換」與「跳頁」兩件事。
  - 注意：只在已登入時渲染，比照 `AccountBalances` 的處理（hook 不能有條件呼叫）。
  - 驗收：測試——已封存的帳本不出現在選項中；切換後首頁的交易列表跟著換（`['transactions', ledgerId]` 換 key 重取）。
- [x] **4.2 帳本只有一本時的呈現**
  - 內容：只有一本帳本時，下拉沒有切換的意義。顯示帳本名稱即可，不畫成可展開的下拉。
  - 驗收：測試——一本時不渲染 `<select>`；兩本以上才渲染。

## Step 5：帳本明細與改名

- [x] **5.1 `LedgerDetailPage`**
  - 內容：路由 `/ledgers/:ledgerId`，用 `GET /ledgers/:id` 取明細。顯示名稱、幣別、**帳本類型**與連動設定（皆唯讀，附「建立後不可更改」說明）、封存時間、我的角色、成員清單。
  - 補充（2026-08-24）：`LedgerDetail` 沒有「我的角色」，只有成員清單。新增 `use-current-user.ts`（`GET /users/me`），從成員清單裡比對出自己那一筆。這也是 owner 專屬操作要不要顯示的依據——**那是體驗，不是授權**。
  - 注意：直接開一個沒有權限的 id，後端回 404。要顯示「找不到這本帳本」，**不可顯示「無權限」**——那會洩漏該帳本存在。
  - 驗收：測試——404 時顯示找不到；不出現任何暗示帳本存在的字眼。
- [x] **5.2 改名**
  - 內容：owner 才看得到入口（D7）。
  - 偏離（2026-08-24）：**另寫 `LedgerRenameDialog`，不沿用 `LedgerDialog`**。建立表單現在裝著兩組不可變更的選擇、參與者清單，以及「部分成員加入失敗」的重試狀態；改名只有一個欄位。硬塞進同一個元件會得到一堆 `if (isRename)`，兩種用途都變難讀。`AccountDialog` 能共用，是因為它的新增與編輯只差一個欄位。
  - 驗收：測試——非 owner 看不到改名按鈕；改名成功後標題與列表都更新。

## Step 6：成員管理

### Step 6 開工提案的決議

開工前以 HTML 提案頁逐題確認（`docs/artifacts/step-slice-2-06-members.html`，不進版控），
結論如下。編號 S6-D1～S6-D4 只屬於 Step 6。

| #     | 議題                     | 決議                                                                                                                          |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| S6-D1 | 改角色的下拉含不含擁有者 | **含**。移交擁有權是真實需求；不給的話，owner 想退出時沒有第二位 owner 就永遠卡在 409                                         |
| S6-D2 | 改角色的介面             | **那一列直接是下拉，選了就送出**。錯誤貼在該列底下，下拉退回原值。角色可以隨手改回來，不值得一個彈窗                          |
| S6-D3 | 移除與退出的確認強度     | **一般 `ConfirmDialog`，不必打字**。人可以再被加回來。打字確認留給 Step 7 的封存 / 刪除，兩者用同一種儀式會讓那個訊號失去意義 |
| S6-D4 | 封存帳本退不出去         | **前端閃避**：封存帳本的成員區塊不顯示任何操作，改成一行「帳本已封存，僅可讀取」。放寬 guard 屬 API 變更，記入延後清單        |

**S6-D4 的背景**：`LedgerAccessGuard` 對封存帳本擋掉所有非 GET 請求
（`ledger-access.guard.ts:78`），`DELETE …/members/{userId}` 也在內。所以帳本一被封存，
成員就再也退不出去。這大概不是刻意設計的——封存的用意是「收起來」，不該連「我不想再
看到這本帳」都做不到。

**與「解除封存」是同一個問題的兩面**：封存帳本目前既退不出去、也解不開
（見 `docs/specs/phase-2c-accounts.md` §8）。修後端時兩件事值得一起做，
時機建議放在 Slice 2 收尾時一併評估。

- [x] **6.1 `MemberList`**
  - 內容：每列顯示名稱、email、角色。owner 才看得到「改角色」「移除」。**「退出帳本」對所有成員顯示**（D7）。
  - 驗收：測試——以 EDITOR 身分渲染時，看不到改角色與移除他人的按鈕，但看得到「退出帳本」。
- [x] **6.2 加入成員**
  - 內容：`MemberDialog`，欄位為 email 與角色（重用 `MemberFields`，只有一列所以標籤不帶序號）。角色仍只給可編輯 / 唯讀——要給擁有者請在清單上明確變更（S6-D1）。
  - 驗收：測試三條路徑——成功後清單出現新成員；`USER_NOT_FOUND` 顯示「查無此使用者，對方需要先註冊」；`ALREADY_MEMBER` 顯示「這個人已經是成員」。**訊息不可只寫「找不到」或「衝突」。**
- [x] **6.3 改角色**
  - 內容：`PATCH /ledgers/:id/members/:userId`。那一列直接是下拉，含擁有者（S6-D1、S6-D2）。錯誤貼在該列底下。
  - 驗收：測試——把最後一位 owner 降級時，後端回 409 `LAST_OWNER_CANNOT_LEAVE`，畫面顯示「帳本至少要有一位擁有者」且角色沒被改掉。
- [x] **6.4 移除與退出**
  - 內容：移除他人與退出自己共用同一個端點，但確認文案不同（「移除 Bob？」vs「退出這本帳本？」）。用 `ConfirmDialog`，**不需要打字確認**（可以再被加回來，不是不可逆）。
  - 驗收：測試——退出成功後導回 `/ledgers` 且該帳本從清單消失；`LAST_OWNER_CANNOT_LEAVE` 有對應提示。
  - 注意：退出的若是作用中帳本，Step 2.1 的退回邏輯要接得住。這條要有測試。

## Step 7：封存與刪除

- [x] **7.1 `ConfirmDialog` 加 `confirmText`**
  - 內容：新增選用 prop。有值時多渲染一個輸入框，輸入內容與 `confirmText` 完全相符才啟用確認鈕。純加法。
  - 驗收：**Slice 1 的三個既有呼叫點一字未改仍全綠**；新增測試——字串不符時確認鈕停用，相符時啟用。
  - 實作註記（2026-08-24）：既有呼叫點實際只有**兩個**（`AccountsPage`、`LedgerDetailPage`），
    原文寫三個是筆誤。兩處確實一字未改。
  - 實作註記（2026-08-24）：內容拆成 `ConfirmDialogBody` 子元件。`Dialog` 關閉時會整個卸載
    子樹，打到一半的字因此自動清空；`useState` 若留在 `ConfirmDialog` 這一層會活過關閉，
    下次打開還留著上次的字——那正好讓打字確認失去意義。已有測試釘住。
  - 實作註記（2026-08-24）：比對前 `trim` 使用者的輸入（前後空白幾乎都是誤打），
    但送給後端的 `confirm` 一律用帳本原本的名稱，不是使用者打的字。
- [x] **7.2 封存**
  - 內容：owner 才看得到。用 `ConfirmDialog` 且 `confirmText` 設為帳本名稱。文案要明說**封存後無法復原**，並說明封存的效果（轉為唯讀、從切換器消失）。
  - 驗收：測試——確認字串不符時送不出去；封存成功後帳本從切換器消失，且作用中帳本自動退回第一本未封存的。
  - 實作註記（2026-08-24）：封存成功後**不導頁**。已封存的帳本這一頁仍看得到，重新取回的
    明細會自己換成唯讀樣貌；作用中帳本由 `ActiveLedgerProvider` 退回第一本未封存的。
    「從切換器消失」與「作用中帳本自動退回」由 Step 2 的既有測試覆蓋，本步不重複驗一次；
    整條路徑要到 9.2 的瀏覽器實測才算真的走過。
- [x] **7.3 刪除**
  - 內容：owner 才看得到。`DELETE /ledgers/:id?confirm=<帳本名稱>`，同樣用 `confirmText`。
  - 驗收：測試兩條路徑——成功後導回 `/ledgers`；409 `LEDGER_HAS_OTHERS_TRANSACTIONS` 顯示「這本帳本有其他成員記的交易，請改用封存」並提供封存入口。
  - 決議（2026-08-24）：「提供封存入口」用**文字引導**，不在錯誤區塊放按鈕。彈窗訊息換成
    「請關掉這個視窗，改用『封存帳本』」，封存鈕就在同一個「危險操作」區塊裡，看得到。
    放按鈕要讓 `ConfirmDialog` 多開一個 slot，為了省一次點擊把共用元件的介面弄複雜不划算。
  - 實作註記（2026-08-24）：後端的英文訊息由 `FormError` 原樣呈現，前端不改寫它，只多補
    一句「那該怎麼辦」。判斷依據是 `errorCode`，不是比對訊息文字。
- [x] **7.4 順手修掉 `leavingSelf` 的巧合相等**
  - 內容：`removing?.userId === currentUser.data?.id` 在兩者都是 `undefined` 時會得到 `true`。
    彈窗那時是關的，目前不會出事，但那種相等是巧合不是意思。改成先擋掉 `null`。

## Step 8：交易表單依連動設定調整（SC-16）

> **提前到 Step 4 之後做（2026-08-24）**：開發者切到非連動帳本記帳時撞到 400
> `ACCOUNT_NOT_ALLOWED`，畫面上還是照樣顯示帳戶下拉。那是現在就會遇到的錯誤，
> 沒有理由等到 Step 5～7 做完。

- [x] **8.1 `TransactionForm` 改收整個 `ledger`**
  - 內容：props 從 `ledgerId: string` 改為 `ledger: LedgerSummary`。`tracksBalance` 為 false 時**不渲染帳戶欄位**，送出的 body **不帶 `accountId`**。
  - 驗收：測試兩種帳本——連動帳本有帳戶下拉且 body 帶 `accountId`；非連動帳本沒有帳戶欄位且 body 不帶該欄位。**這兩條要獨立寫，不改既有測試。**
- [x] **8.2 非連動帳本不顯示餘額提示**
  - 內容：確認首頁的 `AccountBalances` 不受影響（帳戶屬於使用者，與帳本無關），但非連動帳本記帳後**餘額不會變**是正常的。在表單旁一行灰字說明「這本帳本不影響帳戶餘額」。
  - 驗收：測試——非連動帳本時出現該說明；連動帳本時不出現。
  - 補做（2026-08-24）：連動帳本在帳戶為零時會換成「先去建帳戶」的引導（Slice 1 4.4）。非連動帳本根本不需要帳戶，那個引導會把人送去做一件無關的事，所以那個分支也要加上 `tracksBalance` 條件。多一條測試釘住。

## Step 9：收尾與驗收

- [ ] **9.1 全套指令綠**
  - 驗收：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 全綠。
- [ ] **9.2 瀏覽器實測（對照 Plan §7）**
  - 內容：需要兩個帳號才驗得了成員管理。用 `demo@example.com` 與第二個測試帳號。
  - 驗收：Plan §7 的 6 條逐條走過，SC-7、SC-8、SC-16、SC-17 逐條核對。
- [ ] **9.3 回寫文件**
  - 內容：`docs/specs/phase-2-web-mvp.md` §9 第 5 項打勾；實作過程中偏離計畫的地方回寫本 todo 與 plan。
  - 驗收：spec 與程式碼一致。
- [ ] **9.4 PR**
  - 內容：草擬 `feature/ledgers-ui` 的 PR 標題與描述（Markdown 區塊，依 `.github/pull_request_template.md`）。
  - 驗收：CI 全綠後由開發者 squash merge。
