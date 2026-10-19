# 3k K3：合併計畫、退出預覽與退出

## 實作

- `ledger-leave-plan.ts` 是無資料庫副作用的唯一計畫函式。預覽與執行都呼叫 `loadPlan` 載入相同的來源、本人借還與分帳、帳戶、分類、有效指向與結清摘要，再交給 `planLedgerLeave`，不在 controller 或前端計算金額。
- 計畫依 spec §2.3 產出份額與代墊／代收、結清、本人轉帳、分類對應、個人借還／分帳搬家與撤銷、帳本轉入、撤銷對象餘額及排除項目的帳戶淨變動。份額零只建立代墊；每筆新交易都含 `mergeId` 與 `mergedFromId`。
- 預覽項目的 `accountEffects`、現在帳戶餘額、來源帳本影響與勾選交易影響全部使用 `AccountsService.calculateBalances`。依 §2.3「每筆合併前後帳戶淨效果相同」，勾選原交易的效果就是合併寫入／搬家後的效果，因此預覽使用 `目前 - 來源 + 勾選原交易`；計畫單元測試用正式餘額計算器逐列驗證這個等式，e2e 再比對執行後 `GET /accounts`。
- 帳本轉入沿用 `computeLedgerSummary` 和 shared `myLedgerAmounts`，再用 `loadEffectivePointers` 取出本人的有效指向。只建立沒有交易的 `LEDGER_CARRY_OVER`，不產生提議；個人借還與分帳則改 `ledgerId`，不複製、不改配對。
- 新增 `POST /ledgers/:ledgerId/leave-preview`（200）與 `/leave`（204），兩者使用 `VIEWER` 門檻與 `@AllowOnArchived()`。DTO 驗證必要的 nullable UUID 目標、最多 5000 個 UUID 排除項目、選填布林與確認名稱；Swagger 回應使用具名 DTO。
- 授權先確認來源成員；來源查詢排除其他人的私人借還／分帳，帳戶及對象查詢分別限定 `userId`／`ownerId`。寫入目標的共享合併交易會把非本人帳戶設為 null；分類只指向目標帳本。

## 交易邊界與鎖

- 預覽：一個 `RepeatableRead` 交易，無寫入。執行：一個 `Serializable` 交易，包含全部授權、目標檢查、合併、撤銷、清帳戶、刪指向及刪成員／帳本。兩者交易 timeout 為 30 秒。
- 執行在讀取來源與目標前，以以下 SQL 鎖住帳本列及本人的成員列，直到交易結束；同時鎖成員列才能阻止目標權限在過程中被移除或降級：

```sql
SELECT l."id" FROM "Ledger" l JOIN "LedgerMember" m ON m."ledgerId" = l."id"
WHERE l."id" = ${ledgerId} AND m."userId" = ${userId} FOR UPDATE OF l, m
```

- 嚴格維持 §4.2 的阻擋順序：404 → 封存 → 刪除權限／其他成員／確認名稱／別人帳戶 → 最後 owner → 缺目標／目標資格 → 未知 excluded id。所有檢查完成前不建 `LedgerMerge`。
- 回滾使用真實 PostgreSQL e2e 證明：一例在新交易和 `LedgerMerge` 已寫入後讓撤銷失敗；另一例在帳戶與指向已清除後讓刪帳本失敗。比對完整交易列、合併紀錄、往來、分類、對象、指向、成員與 `GET /accounts`，確認全部還原。單元 mock 不假裝能證明資料庫回滾。

清帳戶的 where 條件原文如下；刻意沒有 `deletedAt` 或 `isTemporary` 條件，且兩端分開更新，不會清掉另一端屬於別人的帳戶：

```ts
await tx.transaction.updateMany({
  where: { ledgerId, account: { userId } },
  data: { accountId: null },
});
await tx.transaction.updateMany({
  where: { ledgerId, toAccount: { userId } },
  data: { toAccountId: null },
});
```

## 經協調者確認的補充與選擇

1. 既有 `DebtEntriesService.removeInTransaction` 與 `SplitsService.removeInTransaction` 要求 EDITOR，會擋住 spec 允許的檢視者退出。協調者授權增加內部選項 `{ purpose: 'ledger-leave' }`：只放寬寫入角色，仍驗證本人紀錄、成員資格及未封存；只有新退出 service 傳入，HTTP DTO 無此選項。單元測試驗證預設 VIEWER 仍 403、退出可以撤銷、他人紀錄 404、封存 409；e2e 覆蓋檢視者搬家、撤銷借還及分帳。
2. 抽出的 `deleteLedgerRows` 在解除外鍵與刪個人分帳後，必須先 `transaction.deleteMany({ where: { ledgerId } })` 再刪帳本。實測若直接依靠 Ledger cascade，會因 `LedgerShare_personId_fkey` 的 RESTRICT 失敗；協調者授權這個必要修正，並要求舊 DELETE 端點的「只剩 owner、有共享分帳與結清」回歸測試。其他私人帳本刪除規則不變；既有兩個單元測試 mock 只增加 `deleteMany` 方法。
3. 來源被 blocker 擋下的預覽：依協調者確認，只略過「有項目但缺目標」的檢查，nullable 目標仍回 200 `allowed: false`。非 null 目標的 404／403／409／400 與未知 excluded id 的 400 仍保留；執行順序不變。
4. 新對象名稱若連「（帳本名）」也已重名，依序補 ` 2`、` 3`，不合併到舊對象；超過資料庫 100 字上限時截短。規格只定義第一次重名的帳本名後綴，沒有定義再次重名與長度上限。
5. 即使全部不勾，傳了非 null 目標仍驗證該目標；`LedgerMerge.targetLedgerId` 一律存 null。私人帳本不接受新退出流程，維持 spec 範圍外。
6. K0 隔離測試把 `/counterparties` 的分頁回應當陣列，在帳戶隔離斷言通過後發生 `body.map is not a function`。經協調者授權，只把 fixture 型別改為 `Paginated<Counterparty>` 並使用 `.items.map`，沒有改隔離斷言。
7. W192 的帳本轉入名稱需要從 `LedgerMerge.sourceLedgerName` 回給畫面，但既定 `DebtEntry` 契約沒有來源資訊。已回報協調者；依其指示 `note` 保持 null，shared 的 `DebtEntry.merge` 契約由總控向開發者送審，核可後由協調者補回應。這項整合補充沒有在本分支修改 shared 或借還回應。

## 驗證

API e2e 使用專屬 `ledger_lvm_leave_test`；沒有執行 Web e2e、沒有更改 schema／migration／shared／web、沒有 push 或開 PR。

| 指令                           | 結果                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- |
| `pnpm lint`                    | 通過，API 與 Web                                                        |
| `pnpm typecheck`               | 通過，shared、API 與 Web                                                |
| `pnpm test`                    | 通過，shared 116、API 556（38 suites）、Web 784（101 files）            |
| `pnpm format:check`            | 通過                                                                    |
| API 的 `ledger-leave` 單元測試 | 2 suites、38 tests 通過，含每列帳戶淨效果不變、阻擋順序與檢視者撤銷權限 |

完整 `pnpm --filter @ledger/api test:e2e`：41 suites，39 通過、2 含已知 K2 失敗；355 tests，350 通過、5 失敗，耗時 325.416 秒。所有其他 API e2e（包括既有私人帳本刪除）通過。核心程式與測試提交為 `d073e2b`（`feat: implement ledger leave previews and merges`）。

- 新 `ledger-leave-merge.e2e-spec.ts`：22 條中 21 通過；主例全部帳戶、份額、分類、帳本轉入斷言通過，僅最後 `GET /ledgers/{id}` 的 K2 存取規則仍回 200，預期 404。
- K0 `ledger-leave-merge-isolation.e2e-spec.ts`：5 通過、4 失敗。K3 要求的四條（誰能預覽與退出兩條、預覽只含自己一條、退出只動自己一條）全部轉綠；另有「沒帳的成員可以移除」通過。
- 新測試包含 SC-K2／K11 預覽與執行帳戶逐一比對、個人借還與分帳的檢視者搬家／撤銷、配對與提議不變、還款分支一起搬家／撤銷、指向與重名、最後 owner 合併刪除、舊 DELETE 外鍵回歸、兩個真實 DB 回滾、軟刪除臨時帳戶清除，以及 DTO 驗證。

仍紅的五條皆為尚未合入本分支的 K2 範圍，已由協調者確認留待整合；未修改這些行為或放寬斷言：

1. 新 suite：`SC-K1/K3/K7：全部合併，各帳戶 GET /accounts 完全不變、統計只加 $1500，往來金額沿用借還頁`。原因僅最後讀取已退出帳本預期 404，基底的 LeftMemberAccess 仍回 200。
2. 隔離：`Carol 記 Bob 付的支出與 Bob 付的結清：都不記帳戶，Bob 的帳戶不變`。基底仍替已退出付款人記臨時帳戶。
3. 隔離：`Bob 有記到他帳戶的交易：擁有者移除 409 MEMBER_HAS_TRANSACTIONS，改成檢視者 200`。基底移除仍回 204。
4. 隔離：`Bob 只有個人借還記在這本帳本：擁有者移除照樣 409`。基底移除仍回 204。
5. 隔離：`舊的自己退出端點：409 LEAVE_REQUIRES_MERGE，還是成員、帳戶不變`。基底自己退出仍回 204。
