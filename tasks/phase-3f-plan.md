# 3f 實作計畫：共享帳本的人併入對象頁與借還

spec：`docs/specs/phase-3f-unified-debts.md`（決策 141～152、W130～W148、SC-F1～SC-F12）。後端與畫面合成一個 PR（spec 開頭的執行順序）。

> 核可：2026-10-07 開發者核可，無修改。

## 1. 元件與相依

整條開在 `feature/unified-debts`（從 `main`）。協調者先 commit 契約，worker 從這個 commit 開分支，驗收後 merge 回來，最後一個 PR。

### 1.1 協調者自己做（契約與隔離測試）

- `packages/shared`：
  - `types/ledger-pointer.ts`：`SetLedgerPointerBody { counterpartyId: string | null }`、`LedgerPointerView { counterpartyId: string | null; auto: boolean }`。
  - `types/counterparty.ts`：`Counterparty` 加 `ledgerParts: LedgerPart[]` 與 `totalBalance: Cents`；`ListCounterpartiesQuery` 加 `nonZero?: boolean`。
  - `types/ledger-group.ts`：`LedgerGroup`（spec §4.2 的形狀）與 `ListLedgerGroupsQuery { unpointed?: boolean }`。
  - 成員與虛擬成員：`AddLedgerMemberBody` 改成 `{ email, role } | { counterpartyId, role }`；`CreateLedgerPersonBody` 加選填 `counterpartyId`。
  - `Ledger` 加 `left: boolean`（spec §4.4，只有已退出的人會看到 `true`）。
  - 錯誤碼 `LEDGER_LEFT`、`COUNTERPARTY_NOT_LINKED`。
- `apps/api/test/unified-debts-isolation.e2e-spec.ts`：SC-F9、SC-F10，先看到紅燈。內容：
  - 別人讀不到我的指向（`/counterparties`、`/ledger-groups` 都不帶出）。
  - `PUT …/pointer` 帶別人的對象、我沒參與過的帳本、或那本帳本以外的人 → `404`。
  - 退出後 `GET …/transactions` 只回 §151 範圍；別人兩人之間的交易、別人之間的結清不出現；篩選與分頁參數不能把範圍放寬。
  - 退出後 `…/people`、`…/settlement-summary`、任何寫入 → `404`；`PUT …/pointer` → `409 LEDGER_LEFT`。
  - 從沒加入過的人 `GET …/transactions` 仍是 `404`。

### 1.2 後端（worker）

1. **schema＋migration**（spec §3）：`LedgerPersonPointer` 一張表，`@@unique([userId, ledgerPersonId])`、三個 FK 都 `onDelete: Cascade`（刪除對象時清掉指向，決策 149）。不回填。
2. **退出後唯讀**（決策 151，與第 1 項無關，可以同時做）：
   - `LedgerAccessGuard` 加一個 opt-in 裝飾器（暫名 `@AllowLeftMember('read' | 'reject')`）。沒標的路由行為完全不變：已退出的人照舊 `404`。
   - 標 `read`：已退出的人（`LedgerPerson.userId`＝我，但沒有 `LedgerMember`）只放行 `GET`，在 request 標記 `ledgerAccess = 'LEFT'`。只標在 `GET /ledgers/{id}` 與 `GET …/transactions`。
   - 標 `reject`：已退出的人回 `409 LEDGER_LEFT`。標在指向的兩個端點。
   - `TransactionsService.list` 在 `LEFT` 時把範圍條件 AND 進 SQL：付款人是我（`payerPersonId`＝我的那筆，或 `payerPersonId` 為 null 且記帳人是我）、名單有我、結清的任一方是我。查詢參數只能再縮小範圍。
   - `GET /ledgers/{id}` 對已退出的人回名稱與 `left: true`。
3. **指向**（決策 146～150）：`PUT`／`DELETE …/people/{personId}/pointer`；`EffectivePointers` 一次算出某使用者在所有帳本的有效指向（明確設定優先，其次自動：帳本裡的人的帳號＝我某個連動對象的對方帳號）。服務層檢查對象屬於我、那個人屬於這本帳本、不是我自己那筆（`400`）。
4. **總額與帳本群組**（決策 142～145）：
   - 把 `SettlementsService.summary` 的計算抽成可重用的函式，輸入帳本 id，輸出 `suggestions`。
   - `GET /counterparties`：對我參與過的每本 `SHARED` 帳本（含封存、不連動、已退出）算一次 suggestions，取「我付或我收」的轉帳，依有效指向掛到對象的 `ledgerParts`，算 `totalBalance`。排序與 `nonZero` 以 `totalBalance` 為準。
   - `GET /ledger-groups`：同一份計算結果分組。`unpointed=true` 只回沒指向且金額不為 0 的人。群組的列出規則照 W130、W133。
5. **新增成員的兩種入口**（spec §4.3）：`POST …/members { counterpartyId, role }`（只收已連動，否則 `400 COUNTERPARTY_NOT_LINKED`；用連動的帳號走現有 `addMember`）；`POST …/people` 的 `counterpartyId`（建虛擬成員與指向在同一個資料庫交易）。

### 1.3 純函式（worker，`packages/shared`）

`packages/shared/src/ledger-debts.ts`，只能 `import type`：

- `myLedgerAmounts(suggestions, myPersonId)`：回 `Map<personId, Cents>`，我收＝正、我付＝負（決策 142）。
- `resolvePointer({ explicit, linkedCounterpartyByUserId, personUserId })`：決策 148 的判斷，回 `{ counterpartyId, auto }`。
- `mergeTotals(balance, parts)`：決策 143。

單元測試用 spec §1 的花蓮三日數字。

### 1.4 畫面（worker）

前端只顯示，金額、合併、分組都來自 API（spec §7 Never）。

| 區塊       | 決策                       | 主要檔案                                                                  |
| ---------- | -------------------------- | ------------------------------------------------------------------------- |
| 對象頁     | W130～W133                 | `features/counterparties/`（帳本群組、指向彈窗）                          |
| 借還頁     | W134～W136、W138、W139     | `features/debts/`（總額箭頭、展開來源、帳本群組、往來帳明細的共享帳本段） |
| 帳本頁成員 | W140～W146                 | `features/ledger-people/`、`pages/LedgerDetailPage.tsx`                   |
| 結清與唯讀 | W137（接收端）、W147、W148 | `features/settlements/`、唯讀畫面的新路由                                 |

W137 的跨頁傳遞：借還頁送出「切到帳本 X、打開結清表單、預填轉帳 Y」的導覽狀態，結清那邊接收。兩邊由不同 worker 做，所以導覽狀態的型別由協調者在契約 commit 裡先定（`apps/web/src/features/settlements/settle-intent.ts`）。

## 2. 實作順序

1. 契約、純函式介面、隔離測試（協調者）→ commit 到 `feature/unified-debts` → 開 worktree 與資料庫 → 派第 1 波。
2. 第 1 波：schema＋指向、退出後唯讀、純函式、四塊畫面同時進行（畫面用 mock 的 API 回應寫元件測試）。
3. 第 2 波：總額與帳本群組、新增成員的兩種入口（依賴 schema）。
4. 第 3 波：API 情境 e2e 與回歸；Web e2e 主線（依賴全部 merge）。
5. 協調者整體驗收 → PR → CI → 合併 → 替開發者部署。

## 3. 風險與對策

| 風險                                                                            | 對策                                                                                                                                                                              |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **唯讀放行開出漏洞**：改 guard 時讓已退出的人碰到其他端點，或讓從沒加入的人通過 | 放行是 opt-in，只標 3 個 handler；沒標的路由 guard 邏輯一行不改。隔離測試逐一打 people、settlement-summary、各寫入端點，以及「從沒加入過」的人。協調者逐行看 guard diff           |
| 唯讀範圍靠查詢參數被放寬（例如 `payerPersonId=別人`）                           | 範圍條件在 service 以 AND 加進同一條 SQL，篩選只能疊加；隔離測試帶篩選與分頁各打一次                                                                                              |
| 已退出又重新加入：指向與 `LEFT` 判斷錯亂                                        | `LedgerPerson` 本來就沿用同一筆（3e）；`LEFT` 只看「此刻有沒有 `LedgerMember`」。API e2e 加一條「退出→加入→可寫、指向仍在」                                                       |
| 借還頁的帳本金額跟結清檢視對不起來                                              | 兩邊都走同一個抽出來的 summary 函式；SC-F1、F2 驗具體數字；回歸驗 3e 的結清數字不變（SC-F12）                                                                                     |
| `/counterparties` 要對每本共享帳本算一次 summary，帳本多了會慢                  | 一個請求內每本帳本只算一次，`/counterparties` 與 `/ledger-groups` 共用同一個函式。驗收用 dev 資料量量回應時間，目標 < 500ms；超過就記進實作紀錄、另開最佳化任務，不在本 PR 加快取 |
| 自動指向判斷錯：一個帳號對到多個對象，或把我自己算進去                          | 連動是一對一，同一對帳號最多一個連動對象；我自己那筆在函式入口排除。純函式的單元測試涵蓋「改指」「明確不指向」「連動解除後」                                                      |
| `POST …/members { counterpartyId }` 被拿來探測別人的帳號                        | 只接受我擁有且已連動的對象，別人的對象 `404`、未連動 `400`；前端拿不到 email                                                                                                      |
| 平行的畫面 worker 改到同一個檔案                                                | §5 的 Ownership 分開資料夾；路由檔 `App`／`routes` 只歸 `uf-settle`；W137 的導覽型別由協調者先定                                                                                  |
| migration 套到開發者的 `ledger_dev`                                             | 每個 worker worktree 的 `.env` 與 `.env.test` 都指向 `ledger_uf_<名稱>_test`（協調者先建）。合併後協調者先 `pg_dump` 再替開發者 `migrate deploy`                                  |
| shared 改了，Vite 預先打包快取沒失效                                            | worker 與協調者每次 rebuild shared 後刪 `apps/web/node_modules/.vite`；部署步驟照 handoff                                                                                         |

## 4. 驗證點

- 每個 worker：`pnpm lint / typecheck / test / format:check`；碰後端的再跑自己資料庫的 `test:e2e`；碰 schema 的跑 `prisma migrate status`。
- 協調者：
  - 逐行看 migration SQL、guard、唯讀範圍的 SQL、指向的歸屬檢查、`/counterparties` 的合併。
  - 自己重跑 `unified-debts-isolation.e2e-spec.ts`（要從紅轉綠）與兩套 e2e。
  - 用 dev 資料對 SC-F1、F2 的數字（明哥 101200、小華 139400）。
  - `pnpm lint / typecheck / test / build / format:check` 全綠。
- 合併後：替開發者備份並部署（handoff「替開發者部署」，含 `prisma generate`、`migrate deploy`）。

## 5. 派工

角色照 `docs/orca-multi-agent.md` §0：會碰錢、授權、migration 的給 `backend`，其餘給 `default`。開發者 2026-10-06 再次指示「多用 worker」，所以每塊能獨立驗收的都拆成一個 worker。

每個 worker 一個 worktree、一個分支，從契約 commit 開出。會碰 Prisma 的 worktree，`.env` 與 `.env.test` 都指向 `ledger_uf_<名稱>_test`。API e2e 各用各的資料庫，可以同時跑；Web 的 Playwright 只有 `uf-web-e2e` 跑。

| 波次 | worker           | 角色      | 範圍                                                                               | 驗收                                                                |
| ---- | ---------------- | --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1    | 協調者           | —         | §1.1 契約、W137 導覽型別、隔離測試                                                 | 隔離測試紅燈；shared build 後 API／Web typecheck 只剩「未實作」錯誤 |
| 1    | `uf-schema`      | `backend` | §1.2 第 1、3 項：migration、指向端點、`EffectivePointers`                          | SC-F3、F4、F5；隔離測試的指向部分轉綠                               |
| 1    | `uf-left`        | `backend` | §1.2 第 2 項：guard 裝飾器、唯讀範圍、`GET /ledgers/{id}` 的 `left`                | 隔離測試的退出部分轉綠；既有 guard 單元測試全綠                     |
| 1    | `uf-shared`      | `default` | §1.3 純函式與單元測試                                                              | spec §1 數字的單元測試全綠                                          |
| 1    | `uf-people-dir`  | `default` | 對象頁 W130～W133                                                                  | 元件測試涵蓋帳本群組、指向彈窗、已退出不能設定                      |
| 1    | `uf-debts`       | `default` | 借還頁 W134～W136、W138、W139，W137 送出端                                         | 元件測試涵蓋總額、展開、帳本群組、兩清不列、點來源送出的導覽狀態    |
| 1    | `uf-members`     | `default` | 帳本頁 W140～W146（畫面）                                                          | 元件測試涵蓋單一清單、滑出選項（含關掉動畫）、邀請確認、只加名字    |
| 1    | `uf-settle`      | `default` | W137 接收端、W147 唯讀畫面與路由、W148 兩張卡片                                    | 元件測試涵蓋預填、唯讀畫面無寫入入口、兩張卡片                      |
| 2    | `uf-balances`    | `backend` | §1.2 第 4 項                                                                       | SC-F1、F2、F6、F7、F9 的金額部分                                    |
| 2    | `uf-members-api` | `default` | §1.2 第 5 項                                                                       | SC-F8                                                               |
| 3    | `uf-api-e2e`     | `default` | `unified-debts.e2e-spec.ts` 一條情境走完 SC-F1～F9；既有 e2e 回歸                  | 新舊 API e2e 全綠                                                   |
| 3    | `uf-web-e2e`     | `default` | Web e2e 主線（設定指向 → 借還頁總額 → 點來源記結清 → 總額更新）；既有 Web e2e 回歸 | 兩套 Web e2e 全綠                                                   |

- 檔案歸屬：`ledgers/guards/` 與 `transactions/` 只歸 `uf-left`；`ledger-people/` 的指向端點歸 `uf-schema`，`POST …/people` 的 `counterpartyId` 歸 `uf-members-api`；`debts/counterparties.*` 與 `settlements/` 的 summary 抽取歸 `uf-balances`。`app.module.ts` 由協調者 merge 時處理。
- worker 不改 `packages/shared`（要改先問協調者），`uf-shared` 只改 `ledger-debts.ts` 與它的測試。
- 第 1 波的畫面 worker 依 shared 型別寫 mock；第 2 波 merge 後，協調者在 dev 資料上實際點過一次再派 `uf-web-e2e`。

## 6. 實作紀錄

2026-10-07，一個 Orca Run（`run_78a4a8ab6c17`），三波共 12 個 worker。

| worker           | 角色                     | 結果                                                                              |
| ---------------- | ------------------------ | --------------------------------------------------------------------------------- |
| `uf-schema`      | `backend`                | 一次通過；migration SQL 與 spec §3 一致                                           |
| `uf-left`        | `backend`                | 一次通過；guard 只對標了裝飾器的 3 個 handler 放行                                |
| `uf-shared`      | `default`                | 一次通過                                                                          |
| `uf-people-dir`  | `default`                | 一次通過                                                                          |
| `uf-debts`       | `default`                | 通過；兩處防禦寫法由協調者移除（下方第 4 點）                                     |
| `uf-members`     | `default` → `fallback-1` | Codex 額度用完，Pi GLM 接手完成；協調者改掉動畫偵測（下方第 5 點）                |
| `uf-settle`      | `default`                | Codex 額度用完時程式已完成，由協調者驗收、改寫唯讀列表後 commit（下方第 3 點）    |
| `uf-balances`    | `backend`                | Codex 額度用完時程式與測試已全綠，由協調者逐行驗收後 commit                       |
| `uf-members-api` | `default` → `fallback-1` | Codex 額度用完，Pi GLM 接手完成                                                   |
| `uf-api-e2e`     | `fallback-1`             | Codex 用完，直接派 Pi GLM                                                         |
| `uf-web-e2e`     | `fallback-1`             | 寫完測試、還沒驗證時 GLM 額度也用完；協調者接手跑完並修掉兩個產品問題（第 10 點） |

偏離與補充：

1. **契約補強**：派工時發現 `resolvePointer` 與 `/ledger-groups` 的 web hook 會被兩個 worker 同時需要，協調者先實作進契約（`7bb71b8`），避免撞檔。
2. **spec 沒寫、實作時定下的行為**（已補進 spec §4.1、§4.4）：指向端點回 `200`＋有效指向；封存帳本也能設定指向（`@AllowOnArchived`，指向是自己的設定）；合併對象時指向搬到目標；已退出者的帳本明細 `members` 為空、交易的 `accountPending` 為 `false`。
3. **唯讀列表**：`uf-settle` 的唯讀畫面在每筆交易塞假的 `debt` 標記來借用「不可點」判斷。協調者改成 `TransactionList` 的正式 `readOnly` 屬性。
4. **防禦寫法**：`uf-debts` 在元件裡檢查 `/ledger-groups` 回應形狀、`totalBalance` 缺值時退回 `balance`，實際是遷就 `TransactionsPage.test.tsx` 缺 `/ledger-groups` 與新欄位的假資料。改成修假資料、移除防禦。
5. **動畫**：Task spec 誤要求看作業系統的 `prefers-reduced-motion`，與 `global.css` 記載的 2026-09-24 決定（只看站內開關）衝突。`uf-members` 的 worker 指出後，協調者移除系統偵測，只靠 `--motion-*` token。
6. **額度**：Codex（sol 與 luna 共用 5 小時視窗）在第 2 波中途用完，13:13 重置。`backend` 的 `uf-balances` 剛好已完成，不必問開發者；`default` 依 §4 自動換到 `fallback-1`。
7. **效能**：`/counterparties` 在 10 本共享帳本、每本 20 筆交易時約 62ms（`ledger-groups.e2e-spec.ts` 量測），低於 500ms 目標，不需要快取。代價：回傳單一對象時也會重算全部共享帳本的結清。
8. **dev 資料手動點過一次**（plan §5 最後一條）改為：dev 資料庫要等合併後才 migrate，所以以 Web e2e 主線取代，合併部署後再請開發者實際操作。
9. **罕見競態**：設定指向的同時對象被刪除，外鍵會讓請求回 500（不會寫壞資料）。沒有處理。
10. **Web e2e 抓到的兩個產品問題**（都在 `feature/unified-debts` 修掉）：
    - 借還頁每一列加了 `aria-label="開啟X的往來帳"`，蓋掉原本「名字＋金額」的可存取名稱，螢幕閱讀器讀到的內容變了，既有 e2e 也找不到列。拿掉 `aria-label`。
    - App 開著時被加進新帳本，帳本清單快取裡沒有它；點借還頁的帳本來源會被當成「不在我的帳本」而悄悄退回明細。改成先重抓一次帳本清單，抓完還找不到才忽略，並補單元測試。
    - 另修兩處測試錯誤：補的往來紀錄金額寫成 `100`（1 元，API 單位是分）；存檔後右側欄收起但內容不卸載（#84），不能驗「表單消失」。
11. **GLM 額度**：Pi GLM 在第 3 波也用完（13:52 重置）。`uf-web-e2e` 只剩驗證，協調者自己跑完，沒有再往 `fallback-2` 派。
