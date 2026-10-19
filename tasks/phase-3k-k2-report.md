# 3k K2 退出後規則驗收報告

分支：`polluxyz/lvm-rules`。完成決策 189、191、192、204、206、207 對既有 API 的調整；退出與合併端點仍由 K3 負責。未修改 Prisma schema、migration、shared、Web、路由或餘額公式。

## 實作結果

- 付款人純規則要求傳入人物狀態；交易與結清沿用 `lockPeople` 回傳的狀態。已退出與虛擬人物均不記帳戶、不查臨時帳戶，也不沿用 UPDATE 的舊帳戶。指定不屬於付款人的帳戶仍回 400。
- 結清 UPDATE 即使雙方沒換人，也會清除退出者既有的帳戶引用；現任成員的另一側沿用原本規則。
- 移除 `LeftMemberAccess`、`LedgerAccessKind`、`LedgerAccess` 與所有呼叫參數；非成員包含已退出者一律由 guard 回 404，API 不再丟 `LEDGER_LEFT`。
- 借還群組只查 `members.some.userId` 的共享帳本；結清歷史計數 SQL 內連接目前成員與共享帳本。對象清單與明細都經 `partsByCounterparty` 共用同一個限定，因此 `counterparties.service.ts` 不需另改查詢。
- 根據 plan §1.3，目前沒有統計彙總端點；退出後交易列表及 `settlement-summary` 的 404 即落實統計範圍。
- 所有新查詢仍限定已授權帳本：交易／結清由 guard 驗成員，刪除由交易內 `loadOwnedLedger` 驗擁有者，移除成員在交易內驗擁有者，群組與計數直接以使用者目前的成員資格收斂。

## 移除成員與刪除帳本

`removeMember` 的自行移除在檢查最後一位擁有者之前回 409 `LEAVE_REQUIRES_MERGE`；OWNER、EDITOR、VIEWER 都適用。擁有者移除別人前，在同一個資料庫交易檢查帳戶引用、個人借還與個人分帳，任何一項存在就回 409 `MEMBER_HAS_TRANSACTIONS`，仍可把對方改成 VIEWER。

「有帳」包含任何交易的 `accountId` 或 `toAccountId` 引用對方帳戶，包含臨時帳戶與軟刪除交易；它們的外鍵仍在，不能因為軟刪就略過。個人借還與分帳則只計 `deletedAt: null`：與 3j `removalPlan` 的 active 判斷一致，已撤銷紀錄只留稽核與解除外鍵，不再有待處理的個人帳。已撤銷借還／分帳若仍留有對方的交易帳戶引用，仍會被第一項擋下；新 e2e 也獨立覆蓋無帳戶個人借還、無帳戶分帳、撤銷後可移除。

刪除阻擋順序為封存 → 共享帳本還有其他成員 → 交易仍引用他人帳戶 → 他人的未撤銷個人借還／分帳。其他成員的錯誤為 `HAS_OTHER_MEMBERS`／409 `LEDGER_HAS_OTHER_MEMBERS`；移除交易 `creatorId` 的舊限制，別人建立但只記自己帳戶的交易不擋刪除。

只剩自己且沒有其他阻擋的共享帳本，`removal-preview.delete.blockedBy` 回 `null`；自己的個人借還／分帳會令 `withdrawsDebts: true`。`DELETE /ledgers/{id}` 未帶 `withdrawDebts=true` 時回 409 `DEBT_WITHDRAWAL_REQUIRED`，同意後照 3j 撤銷自己的個人借還／分帳、解除外鍵再刪帳本，與私人帳本相同。未變更 `remove` 或其內部函式簽章。

## 留給協調者的 shared 與待補帳戶事項

shared 型別維持原狀，下列欄位在 API 的成功回應中現在恆為 `false`，可由總控決定是否另行移除及更新過時的型別註解：

| shared 檔案                                   | 欄位                                                |
| --------------------------------------------- | --------------------------------------------------- |
| `packages/shared/src/types/ledger.ts`         | `LedgerDetail.left`                                 |
| `packages/shared/src/types/ledger-pointer.ts` | `LedgerGroup.ledger.left`                           |
| `packages/shared/src/types/debt.ts`           | `CounterpartyLedgerPart.left`（包含對象清單與明細） |

`isAccountPending` 依指示未修改。現有實作只有「付款人是檢視者，且帳戶等於本人臨時帳戶」才回 `true`；`accountId: null` 一律回 `false`，所以重新加入後的無帳戶交易目前不會顯示待補。若要完整落實決策 191 與 199，後續須在無帳戶且本人為付款人／結清一方時顯示待補，並搭配 K1／K3 的合併紀錄排除已合併交易；只加 `accountId === null` 會錯誤提示已合併交易可補帳戶。

`rg -n "LeftMemberAccess|'LEFT'" apps/api/src` 的必要保留處：`LedgerPeopleService` 的人物狀態；`payer-account-rules.ts` 的人物狀態輸入型別；`LedgerDebtsService.groups` 對「別人已退出且淨額為零」人物的既有過濾（呼叫者仍是成員）；以及對應人物、付款人、結清與群組的測試資料。沒有退出者可存取帳本的分支。

## 驗證

- `pnpm lint`：通過。
- `pnpm typecheck`：通過。
- `pnpm test`：shared 116、API 522、Web 784 條全過。
- `pnpm format:check`：通過；只對本次變更檔案執行 `prettier --write`。
- 新增 `ledger-leave-rules.e2e-spec.ts`：14 條全過。
- 完整 `pnpm --filter @ledger/api test:e2e`：40 個檔案通過、1 個檔案有預期的 K3 失敗；342 條通過、4 條失敗，共 346 條，319.039 秒。
- `ledger-leave-merge-isolation.e2e-spec.ts`：SC-K4 一條與成員移除四條均通過；另外四條由 K3 實作。完整執行時並行根目錄檢查令前兩條先碰到 5 秒逾時，單獨重跑此檔後 5 條通過、4 條均確認為端點不存在的 404，沒有修改逾時設定。
- 最後收緊退出後改／撤銷結清的斷言為精確 404 後，獨立重跑 `debts-inline-isolation.e2e-spec.ts`，8 條全過。
- 未執行 Web e2e。

K3 的四條驗收目前因 `POST /ledgers/{id}/leave-preview`／`leave` 端點不存在而收到 404，測試保持紅燈、不 skip、不更改：

1. 「成員可以預覽；不是成員的 Eve 預覽、退出都 404，沒有寫入」：成員預覽預期 200，端點不存在。
2. 「目標帳本不是我的 404、我是檢視者 403、等於來源帳本 400；還是成員，帳戶不變」：端點不存在，無法執行目標帳本檢查。
3. 「Bob 的預覽看不到 Carol 的帳戶；Carol 付的晚餐沒有帳戶影響」：預覽端點不存在。
4. 「Carol 的帳戶、借還與看到的交易都不變；合併的交易只用 Bob 的帳戶；花蓮三日不再引用 Bob 的帳戶」：退出端點不存在。

## 既有 e2e 調整清單

下列沿用原本 `it` 名稱辨識；部分名稱已隨新規則改寫，每條保留與退出無關的斷言。

- `debt-ledger-write-access.e2e-spec.ts`「%s cannot change a repayment or its branch, including via proposals」：非成員前提改用 Prisma 刪成員，繼續驗還款分支不能被改動。
- `debts-inline-isolation.e2e-spec.ts`「退出後只回我是任一方的結清，分頁放寬不了」：改驗退出後任何分頁參數都回 404。
- 同檔「退出後改或撤銷結清一律被擋，資料不變」：共用前提改用 Prisma，並把舊的 404／409 容許集合收緊為 404。
- 同檔「現任成員算全部；已退出只算跟我有關的」：改驗退出後群組完全不存在。
- `debts-inline.e2e-spec.ts`「SC-G1–G6：分段、過濾、綁定、連動與結清清單依序走完，最後撤銷房東的還款」：退出後結清清單改 404、群組不再出現，其他往來與撤銷斷言保留。
- `ledger-delete-archive-isolation.e2e-spec.ts`「不能刪時不回任何帳戶，看不到 Bob 的餘額」：依新優先順序改驗 `HAS_OTHER_MEMBERS`，仍不洩漏帳戶與對象。
- 同檔「Carol 記一筆 Bob 付的支出：刪除 409，Bob 的帳戶餘額不變」：先直接移除 Bob 資格，確保仍獨立驗到帳戶引用阻擋。
- `ledger-delete-archive.e2e-spec.ts`「SC-J5: shared debts and archived ledgers return blocked previews without balances」：單人共享帳本有自己的借還改可預覽刪除、需撤銷同意，封存仍阻擋。
- 同檔「SC-J4: my transaction on another person’s temporary account blocks deletion even after soft deletion」：先直接移除對方資格，繼續驗未刪與軟刪交易均會因他人臨時帳戶引用而阻擋。
- `ledger-groups.e2e-spec.ts`「keeps an outstanding amount after the caller leaves and excludes settled counterparties」：改驗退出後群組與對象的帳本來源消失，原本不含零餘額對象的斷言保留。
- `ledger-people.e2e-spec.ts`「SC-E1 lists the creator and members, then preserves a person across leave and rejoin」：以 Prisma 模擬退出，人物 id 與重新加入狀態的驗證照舊。
- `ledger-settlements-list.e2e-spec.ts`「returns only settlements involving the viewer after they leave」：改驗退出後結清清單與分頁請求 404。
- 同檔「filters ledger-groups by hasSettlements and counts what the viewer can see」：保留現任成員計數與過濾，退出後改不出現。
- `ledger-settlements.e2e-spec.ts`「SC-E14: keeps a departed member in summary and accepts a settlement on their behalf」：退出前提改 Prisma，替退出者結清的帳戶改驗 `null`，其他成員摘要保留。
- `ledger-splits-scenario.e2e-spec.ts`「SC-E2–E19: follows the Hualien trip through split, settlement, guest, departure, and 3c regression」：只把退出前提改 Prisma，保留完整分帳與結清回歸情境。
- `ledgers.e2e-spec.ts`「refuses to delete a ledger holding other members' transactions (SC-C11)」：還有其他成員時改驗優先錯誤 `LEDGER_HAS_OTHER_MEMBERS`。
- 同檔「keeps a shared ledger shared after everyone else leaves (SC-D5)」：以 Prisma 模擬退出，保留帳本 kind 不變及可重新加人的斷言。
- `splits-isolation.e2e-spec.ts`「fromTransactionId：原交易所在的帳本已經不能寫入 → 404，原交易不受影響」：非成員前提改 Prisma，繼續驗無法藉轉分帳修改無權帳本。
- `unified-debts-isolation.e2e-spec.ts`「交易列表只回跟他有關的帳」：改驗退出後交易列表 404。
- 同檔「篩選與分頁不能放寬範圍」：改驗帶付款人與分頁篩選仍然 404。
- 同檔「帳本明細只給名稱與 left，不給成員」：改驗退出者 404，現任擁有者仍可讀且 `left: false`。
- 同檔「其他帳本端點與所有寫入都是 404，什麼都沒寫」：共用退出前提改 Prisma，保留所有不寫入與授權斷言。
- 同檔「設定或清掉指向回 409 LEDGER_LEFT」：改驗 404 `NOT_FOUND`。
- 同檔「退出後重新加入，可以照常讀寫」：共用退出前提改 Prisma，保留重新加入後明細與交易清單驗證。
- 同檔「退出後讀不到別人之間的交易（同 SC-F9，從另一個人的角度）」：改驗交易列表完全不可存取。
- `unified-debts.e2e-spec.ts`「SC-F1–F7、F9：花蓮三日貫穿總額、指向、結清與退出，數字與結清檢視一致」：舊端點改驗 `LEAVE_REQUIRES_MERGE`，模擬退出後對象來源及群組消失、讀取與指向均 404。

刪除一條 `it`：`unified-debts-isolation.e2e-spec.ts` 的「退出不影響帳戶餘額」，因為它驗的是已取消的 3f「退出後原帳本餘額照算」，新的合併保全餘額屬 K3；只刪成員模擬退出不能驗證完整退出的餘額行為。
