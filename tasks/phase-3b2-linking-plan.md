# 實作計畫：3b-2 往來帳連動（後端）

> 依據：`docs/specs/phase-3b2-linking.md`（決策 51～72、SC-K1～K18），開發者 2026-09-25 核可。
> 分支：`feature/phase-3b2-linking-api`，一個 PR。
> 涉及授權、資料隔離、schema、API，全部由協調者自己做，不派 worker（`CLAUDE.md` §11）。
> 畫面另寫 `phase-3b2-web.md`，不在本 plan。

---

## 1. 元件與相依

```
S1 shared 契約 ─→ S2 schema + migration ─→ S3 隔離測試先行（紅燈）
                                              │
          ┌───────────────────────────────────┤
          ▼                                   ▼
S4 連動：建立對象、邀請、接受、解除     S5 提議：送出、列表、接受、拒絕
          └──────────────┬────────────────────┘
                         ▼
          S6 回應欄位：link、sync、paired ─→ S7 e2e 與全套驗證
```

S4 與 S5 共用 S2 的 model，但程式碼互不相依；S5 的 e2e 需要 S4 先能建立連動。

## 2. 程式放哪裡

| 檔案                                                    | 內容                                                                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/debts/counterparty-links.ts`（新）        | 連動的共用函式：讀連動、建立、解除（刪連動、刪好友、清配對、作廢提議與邀請）。沿用 `friendship.ts` 的寫法：純函式、吃 `tx` |
| `apps/api/src/debts/debt-proposal-rules.ts`（新）       | 種類對照（§3.2）、角度轉換、`sync` 推導、送出提議的函式（新增、變更、刪除、作廢）                                          |
| `apps/api/src/debts/debt-recording.ts`（新）            | 從 `DebtEntriesService` 抽出「依 `record` 產生交易」「補結清差額」，讓接受提議共用                                         |
| `apps/api/src/debts/debt-proposals.service.ts`（新）    | 列表、接受、拒絕                                                                                                           |
| `apps/api/src/debts/debt-proposals.controller.ts`（新） | `/debt-proposals`                                                                                                          |
| `counterparties.service.ts`、`.controller.ts`           | `POST`、`?q=`、`link`、`sync`、`paired`、邀請連動、解除連動、刪除擋連動中                                                  |
| `debt-entries.service.ts`                               | 新增、修改、刪除時呼叫提議函式                                                                                             |
| `friends/friend-requests.service.ts`                    | 連動邀請的建立與接受；決策 8 的自動接受只看一般邀請                                                                        |
| `friends/friend-invite-links.service.ts`                | 連動邀請連結的建立、預覽、接受                                                                                             |
| `friends/friends.service.ts`                            | `remove` 改呼叫 `counterparty-links.ts` 的解除函式（決策 70）                                                              |

**模組相依**：好友端點要建立與解除連動，往來帳端點要建立好友邀請。為了不讓 `FriendsModule` 與 `DebtsModule` 互相 import，兩邊共用的是**純函式檔**（`counterparty-links.ts`、`friendship.ts`），不是 service。邀請的建立邏輯留在 friends 的 service，`CounterpartiesController` 注入 `FriendRequestsService`、`FriendInviteLinksService`（`DebtsModule` import `FriendsModule`，單向）。

## 3. 實作重點

### 3.1 資料模型（spec §4）

- `DebtEntry.pairedEntryId`：自我關聯 `@unique`，`onDelete: SetNull`。對方刪帳號時，我的紀錄自動變回未配對。
- `DebtProposal`：`fromUser`、`toUser`、`sourceEntry` 為 `Cascade`；`targetEntry` 為 `SetNull`。
- `DebtProposal` 另存 `amount`、`date` 給 `DELETE`（刪除當下的值），讓接受者看得出是哪一筆。spec §4 註解只寫 CREATE、AMEND，屬於補充，不改 API 形狀。
- `CounterpartyLink`：兩個 user、兩個 counterparty 的外鍵都 `Cascade`。
- `FriendRequest.counterpartyId`、`FriendInviteLink.counterpartyId`：`Cascade`（spec §4.1 第 4 點）。

### 3.2 連動邀請

- 建立（email）：先照 3a 的順序檢查（使用者存在、不是自己），再檢查：對象未連動 → 這對使用者未連動 → 對方沒有待確認的連動邀請給我（`LINK_INVITE_FROM_THEM`）→ 我沒有待確認的邀請給他（沿用 `FRIEND_REQUEST_PENDING`）。已經是好友**不擋**。
- 3a 決策 8 的反向自動接受：`reverse` 查詢加上 `counterpartyId: null`，連動邀請不會被一般好友邀請自動接受。
- 接受：`counterparty` 必填；在同一個資料庫交易裡：條件式更新邀請狀態 → 解析接受者的對象（`{ id }` 要未連動、`{ name }` 用 upsert 且撞名要擋）→ 還不是好友就建立 → 建立 `CounterpartyLink`（`P2002` 轉 `ALREADY_LINKED`）。任何一步失敗整筆回滾，邀請不被消耗。
- 邀請連結的接受回應：沿用 `Friend`，另帶 `counterpartyId`（接受者那邊接上的對象），讓畫面接受後能直接開那本往來帳。這是回應多一個選填欄位。

### 3.3 提議

- **送出**與發起者的寫入在同一個資料庫交易裡。對象未連動就什麼都不做。
- `POST /debt-entries`、`forgive`：種類在決策 62 範圍才送 `CREATE`；`settle` 記在提議上，結清差額本身不送。
- `PATCH`：先看有沒有待確認的 `CREATE`，有就更新它的 `amount`、`date`；否則已配對且金額或日期變了，就作廢舊的待確認提議再送 `AMEND`（決策 68）。只改備註不送。
- `DELETE`：待確認的 `CREATE` → 作廢；已配對 → 作廢其他待確認提議、清空雙方配對、送 `DELETE`。
- **接受**：先以 `updateMany where status = PENDING` 搶下提議（`count = 0` 回 `PROPOSAL_NOT_PENDING`），再鎖接受者的對象（決策 50），再照 §3.2 寫入。檢查失敗丟例外，整筆回滾，提議回到 `PENDING`。
- 接受還款時，接受者要寫的方向與自己的餘額方向相反（例如發起者存 `COLLECT`，接受者要寫 `REPAY`，但接受者的帳上是對方欠他），回 `409 NOTHING_TO_REPAY`：從接受者的帳看，他沒有這個方向的欠款可還。這是決策 65 的延伸解讀。
- **鎖的順序**：發起者＝自己的對象 → 提議 → 自己的紀錄；接受者＝提議 → 自己的對象 → 發起者的紀錄（寫配對）。兩條路徑都先拿到「提議」這一列才碰對方的東西，不會形成循環等待。

### 3.4 `sync` 的推導（spec §3.4）

對一頁的紀錄，一次查出它們送出的提議（`sourceEntryId in (...)`，新到舊），每筆取最新一筆：`PENDING` → `PENDING`；`DECLINED` → `DECLINED`；否則已配對 → `SYNCED`；其餘 `NONE`。推導寫成純函式並有單元測試。

### 3.5 `theirBalance`

清單：再一次 `groupBy` 算出所有連動對方那邊對象的餘額，取負號。單一對象：一次 `aggregate`。對方的對象 id 只在 service 內部使用，不回傳。

### 3.6 解除（決策 70～72）

一個資料庫交易：刪 `CounterpartyLink` → 刪 `Friendship` → 清空兩個對象所有紀錄的 `pairedEntryId` → 雙方之間 `PENDING` 的提議與連動邀請改 `CANCELLED`。`DELETE /friends/{id}` 與 `DELETE /counterparties/{id}/link` 呼叫同一個函式。對象與名字不動（決策 71）。

### 3.7 Web 端的最小調整

shared 型別加欄位後，Web 的測試假資料與 `Record<DebtEntryKind, …>` 會編譯失敗。本 PR 只補到 typecheck 與測試通過（假資料加 `link: null`、`sync`、`paired`；`FORGIVEN` 的中文標籤「被免除」），不做任何新畫面。

## 4. 風險與對策

| 風險                                                 | 對策                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 提議寫入對方的帳，是本專案第一個「寫別人資料」的路徑 | 只有接受者本人的請求能寫入他的帳；隔離測試先行（SC-K15）；接受時所有帳本、帳戶檢查以接受者身分做         |
| 兩個人同時操作同一對紀錄                             | §3.3 的條件式更新與鎖順序；SC-K16 用 `Promise.all` 驗證                                                  |
| 解除連動漏清某一種狀態                               | 一個函式、一個資料庫交易；SC-K12 逐項檢查                                                                |
| 3a 一般好友邀請的行為被改壞                          | 3a 的 e2e 全部維持綠燈；決策 8 的反向查詢補單元測試                                                      |
| 回應多了欄位，洩漏對方資料                           | `link` 只給 `userId`、`userName`、`theirBalance`；提議的回應函式分收件者與發起者兩個版本，各自有單元測試 |

## 5. 驗證點

- S3 之後：隔離測試全部紅燈（端點不存在或行為不對）。
- S5 之後：SC-K5～K11、K16、K17 的 e2e 綠燈。
- 最後：`pnpm lint / typecheck / test / build / format:check`、兩套 e2e 全綠；`prisma migrate status` 無 pending。

## 6. 實作紀錄

（實作中遇到的計畫外問題與處理記在這裡。）
