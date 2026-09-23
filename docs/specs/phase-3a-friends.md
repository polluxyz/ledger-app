# Spec：階段三 (3a) — 好友系統

> 狀態：**已實作**（2026-09-23）
> 依據：2026-09-23 的假設清單逐題確認，詳見 §2。借還帳（3b）已定案的部分記在 `專案決策脈絡.md`「階段三定案」一節，3b 的 spec 等本步完成後再寫。
> 定位：**純後端**。Web 畫面另立步驟。
> 前置：**email 大小寫正規化**（見 §2 決策 18）已於 PR #51 合併。
> 執行順序：階段二（已完成）→ email 正規化 → **本步（3a）** → 3b 借還帳 → 階段三的 Web 畫面。

---

## 1. 目標與成功樣貌

讓兩個使用者建立「好友」關係。好友是 3b 借還帳的前提：只有好友之間，借還記錄才能連動到對方的帳上。

本步完成後，使用者可以用兩種方式加好友：輸入對方的 email 送出邀請，或產生一條邀請連結交給對方。對方接受後，雙方的好友清單都會出現彼此。

好友關係**只是社交層**。它不讓任何人多讀到一筆帳本、帳戶或交易（SEC-19）。

### 範圍內

- 好友邀請（以 email 送出）：送出、接受、拒絕、取消。
- 邀請連結：產生、預覽、接受。QR code 只是同一條連結畫成圖，屬前端，後端不需另做。
- 好友清單、解除好友。
- 好友相關的授權模型（SEC-20 中與好友有關的部分）。
- `@ledger/shared` 型別與錯誤碼；單元測試與 e2e 測試。
- 同步修正 `security-baseline.md` 的 SEC-11（見 §2 決策 3）。

### 範圍外（見 §8）

- 借還帳（3b）。
- 所有 Web 畫面。
- 從好友清單挑選帳本成員（目前仍輸入 email）。
- 搜尋使用者、封鎖、好友備註名。
- 帳本的邀請連結（`phase-2d-ledger-kind.md` §8）。本步的連結機制日後可沿用，但本步不做。

---

## 2. 已定案的決策

| #   | 決策                                                                               | 理由摘要                                                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | 好友是**雙向對稱**關係，一對使用者只存一筆                                         | A 是 B 的好友，B 就是 A 的好友。存兩筆的話，只要有一條路徑漏寫一筆，關係就只剩單邊                                                                                             |
| 2   | 兩種加好友方式：**email 邀請**與**邀請連結**                                       | 連結解決「不知道對方 email」與「打錯 email」。QR code 是連結的另一種呈現，不是第三種機制                                                                                       |
| 3   | email 沒有註冊時，**明確回「找不到這個使用者」**（`404 USER_NOT_FOUND`）           | 開發者定案：打錯 email 時要讓使用者知道。代價與 SEC-11 的改寫見下方「使用者列舉」                                                                                              |
| 4   | email 邀請要對方**接受**才成立                                                     | 不能讓別人單方面把你列為好友                                                                                                                                                   |
| 5   | 邀請連結被接受就**直接成立**，發起者不必再確認                                     | 產生連結並交出去，本身就是發起者的同意                                                                                                                                         |
| 6   | 連結 **10 分鐘過期**、**只能用一次**                                               | 開發者定案。主要用途是當面掃 QR code，10 分鐘足夠；壽命短，外流的損害也短                                                                                                      |
| 7   | 產生新連結時，同一人**舊的未使用連結一律失效**                                     | 每人同時只有一條有效連結，等於內建撤銷，不必另做撤銷端點                                                                                                                       |
| 8   | 對方已經邀請我、我又邀請對方 → **直接成為好友**                                    | 雙方都表達了意願，再要求任一方按一次接受沒有意義                                                                                                                               |
| 9   | 被拒絕後**可以立刻重送**，不設冷卻期；發起者看得到「已拒絕」                       | 開發者定案。重送頻率只受決策 16 的流量限制。隱藏拒絕的話，發起者只會看到永遠的「待確認」                                                                                       |
| 10  | 好友清單只顯示對方的**顯示名稱**與成為好友的時間，**不含 email**                   | 經由連結加入的好友，你從來沒拿到過對方的 email。清單不該把它交出去                                                                                                             |
| 11  | 我送出、尚未被接受的邀請，只顯示**我輸入的 email**，不顯示對方名稱                 | 否則「知道一個 email」就能換到「這個人的名字」                                                                                                                                 |
| 12  | **解除好友是單方動作**，不需對方同意                                               | 擋下等於把人綁在一段自己不想要的關係裡                                                                                                                                         |
| 13  | 解除好友時，3b 的**連動中債務自動轉成雙方各自的單邊記錄**                          | 開發者定案（取代原本「有未結清債務就擋下解除」）。避免債權人不確認還款、債務人就永遠解除不了好友。3a 尚無債務                                                                  |
| 14  | 非當事人存取一筆邀請 → `404`；當事人但動作不對（如發起者按接受）→ `403`            | 與帳本端點一致：不讓外人知道一筆邀請存在；當事人本來就知道，說清楚原因即可                                                                                                     |
| 15  | 好友關係**不改變任何帳本、帳戶、交易的權限**；本步**不改動** `LedgerAccessGuard`   | SEC-19。資源權限仍然只看帳本成員與帳戶歸屬                                                                                                                                     |
| 16  | 送出邀請、產生連結、接受連結：**每 IP 每分鐘 10 次**，用既有的 `@nestjs/throttler` | 與 auth 端點同一套機制，不新增相依。見下方「使用者列舉」                                                                                                                       |
| 17  | 不做搜尋、封鎖、好友備註名                                                         | 搜尋會直接洩漏使用者名單；封鎖與備註名目前沒有需求                                                                                                                             |
| 18  | email **不分大小寫**：以轉成小寫後的值比對                                         | 開發者定案。實務上各家郵件服務都不分大小寫。現況註冊時沒轉小寫，`Foo@x.com` 與 `foo@x.com` 會被當成兩個人，已於 PR #51 修正：DTO 轉小寫、資料庫 CHECK 約束、Web 輸入即時轉小寫 |

### 使用者列舉（決策 3 的代價與 SEC-11 的改寫）

決策 3 讓任何**已登入**的使用者，可以用 email 邀請確認「這個 email 有沒有註冊」。

這不是新開的洞。現況已有兩條更寬的路：

1. **`POST /auth/register`**（`apps/api/src/auth/auth.service.ts:58`）：已註冊的 email 回 `409 EMAIL_ALREADY_EXISTS`。這條**不需登入**。
2. **共享帳本加成員**（`apps/api/src/ledgers/ledgers.service.ts:265`）：未註冊的 email 回 `404 USER_NOT_FOUND`。任何人都能建一本共享帳本來試。

`security-baseline.md` 原本寫「登入端點已防」，這句只對登入端點成立。要真正做到「無法判定」，註冊流程必須改成寄驗證信（「如果這個 email 可用，你會收到信」），而專案目前沒有寄信的基礎設施。

因此 SEC-11 改寫為：**不追求無法判定，改為限制判定的速度**。各條路徑都要有流量限制，並在 spec 裡列出來。註冊驗證信列入延後項目。

### 已知且接受的代價

- **10 分鐘的連結不適合用聊天軟體轉傳。** 對方若沒在 10 分鐘內點開，就要請你重產一條。當面掃 QR code 不受影響。
- **被拒絕的人可以一直重送。** 收件者只能一再拒絕，流量限制讓重送最多每分鐘 10 次。真的出現騷擾時再做封鎖（§8）。

---

## 3. 狀態與授權模型（SEC-20 的好友部分）

### 3.1 好友邀請的狀態

```
               接受（收件者）
          ┌──────────────────▶ ACCEPTED
          │  拒絕（收件者）
PENDING ──┼──────────────────▶ DECLINED
          │  取消（發起者）
          ├──────────────────▶ CANCELLED
          │  對方反向邀請（系統）
          └──────────────────▶ ACCEPTED
```

- 只有 `PENDING` 能轉換。其餘三個狀態是終點，不能再改。
- 對已結束的邀請再做任何動作 → `409 FRIEND_REQUEST_NOT_PENDING`。

### 3.2 邀請連結的狀態

連結不另存狀態欄位，由三個時間欄位推得：

| 狀態   | 條件                                                                 |
| ------ | -------------------------------------------------------------------- |
| 有效   | `usedAt`、`revokedAt` 皆為空，且現在時間早於 `expiresAt`             |
| 已使用 | `usedAt` 不為空                                                      |
| 已失效 | `revokedAt` 不為空（同一人產生了新連結），或現在時間晚於 `expiresAt` |

後三種對外一律回 `404 INVITE_LINK_INVALID`，訊息是「連結已失效，請對方重新產生」。三種情況的補救方法相同，分開說明沒有用處。

### 3.3 誰能做什麼

| 角色             | 能做                                    | 不能做                                          |
| ---------------- | --------------------------------------- | ----------------------------------------------- |
| 邀請的**發起者** | 看自己送出的邀請、取消 `PENDING` 的邀請 | 接受或拒絕自己的邀請（`403`）                   |
| 邀請的**收件者** | 看收到的邀請、接受、拒絕                | 取消別人送來的邀請（`403`）                     |
| 其他任何人       | 無                                      | 讀取或操作這筆邀請（`404`）                     |
| 連結的**產生者** | 產生新連結（舊連結同時失效）            | 接受自己的連結（`400 CANNOT_FRIEND_SELF`）      |
| 連結的**持有者** | 預覽產生者的顯示名稱、接受連結          | 無其他權限                                      |
| **好友**         | 出現在對方的好友清單、解除好友          | 讀取對方的任何帳本、帳戶、交易、好友清單、email |

最後一列是 SEC-19 的具體化。本步的 API **沒有任何端點接受「別人的使用者 ID」來查詢清單**，所以「讀取對方的好友清單」在結構上就不存在。

### 3.4 連結 token 的處理

- token 是 32 bytes 的密碼學隨機值，以 base64url 編碼。
- 資料庫**只存 SHA-256 雜湊值**，不存原文。資料庫外洩時，有效的連結不會跟著外洩。token 本身熵值夠高，所以不需要 bcrypt 這類慢速雜湊。
- token 放在 request body 傳送，**不放在 URL 路徑**。路徑會出現在伺服器的存取日誌裡。
- 給前端的建議：Web 網址把 token 放在 `#` 之後（例如 `/friends/invite#<token>`）。瀏覽器不會把 `#` 之後的內容送給伺服器，也不會放進 Referer 標頭。

---

## 4. 資料模型（Prisma）

> 依 `CLAUDE.md` §14，schema 變更屬於「先說明再做」。本節核可即視為同意；migration 的手寫 SQL 仍要在套用前給開發者看過。

```prisma
enum FriendRequestStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}

/// 一對好友只存一筆。為了讓 (A, B) 與 (B, A) 不會各存一次，
/// 一律把 id 較小者放 userLowId、較大者放 userHighId。
model Friendship {
  userLowId  String
  userHighId String
  createdAt  DateTime @default(now())

  userLow  User @relation("FriendshipLow", fields: [userLowId], references: [id], onDelete: Cascade)
  userHigh User @relation("FriendshipHigh", fields: [userHighId], references: [id], onDelete: Cascade)

  @@id([userLowId, userHighId])
  @@index([userHighId])
}

model FriendRequest {
  id          String              @id @default(uuid())
  requesterId String
  recipientId String
  status      FriendRequestStatus @default(PENDING)
  /// 接受、拒絕或取消的時間。
  respondedAt DateTime?
  createdAt   DateTime            @default(now())
  updatedAt   DateTime            @updatedAt

  requester User @relation("FriendRequestSent", fields: [requesterId], references: [id], onDelete: Cascade)
  recipient User @relation("FriendRequestReceived", fields: [recipientId], references: [id], onDelete: Cascade)

  @@index([recipientId, status])
  @@index([requesterId, status])
}

model FriendInviteLink {
  id        String    @id @default(uuid())
  inviterId String
  /// token 的 SHA-256。原文只在產生當下回給產生者一次。
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  usedById  String?
  /// 同一人產生新連結時，舊的未使用連結在此標記失效。
  revokedAt DateTime?
  createdAt DateTime  @default(now())

  inviter User  @relation("FriendInviteLinkCreated", fields: [inviterId], references: [id], onDelete: Cascade)
  usedBy  User? @relation("FriendInviteLinkUsed", fields: [usedById], references: [id], onDelete: SetNull)

  @@index([inviterId])
}
```

`User` 對應補上 6 個反向關聯欄位。

### Prisma 表達不了、要在 migration 手寫的兩條約束

1. **`Friendship` 的 CHECK 約束**：`"userLowId" < "userHighId"`。擋住 service 忘了排序、或兩個 id 相同的情況。
2. **`FriendRequest` 的部分唯一索引**：同一對發起者與收件者，`status = 'PENDING'` 的邀請最多一筆。Prisma 不支援部分唯一索引。service 會先檢查，這條索引是兩個請求同時送達時的最後防線。

### 刪除使用者時

三張表都跟著使用者 `Cascade` 刪除。例外是連結的 `usedById` 用 `SetNull`：使用者被刪掉，不該連帶刪掉別人產生過的連結紀錄。

---

## 5. API 設計

全部需要登入。新增 `FriendsModule`，放在 `apps/api/src/friends/`。

### 好友邀請

| 方法與路徑                           | 說明                                                 | 成功            | 錯誤                                                                                                |
| ------------------------------------ | ---------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| `POST /friend-requests`              | body `{ email }`                                     | `201`，回傳邀請 | `400 CANNOT_FRIEND_SELF`、`404 USER_NOT_FOUND`、`409 ALREADY_FRIENDS`、`409 FRIEND_REQUEST_PENDING` |
| `GET /friend-requests`               | `?direction=incoming\|outgoing&status=&page=&limit=` | `200`，分頁清單 | —                                                                                                   |
| `POST /friend-requests/{id}/accept`  | 收件者接受                                           | `200`，回傳邀請 | `403`、`404`、`409 FRIEND_REQUEST_NOT_PENDING`                                                      |
| `POST /friend-requests/{id}/decline` | 收件者拒絕                                           | `200`           | 同上                                                                                                |
| `POST /friend-requests/{id}/cancel`  | 發起者取消                                           | `200`           | 同上                                                                                                |

- 決策 8 的情況（對方已邀請我）：`POST /friend-requests` 回 `201`，回傳的是**對方那筆邀請**，狀態已是 `ACCEPTED`。不另建一筆。
- 回應中的對方資訊依決策 10、11：收到的邀請顯示發起者名稱；送出的邀請在 `ACCEPTED` 之前只顯示我輸入的 email。

### 邀請連結

| 方法與路徑                          | 說明                               | 成功                                | 錯誤                                                                       |
| ----------------------------------- | ---------------------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| `POST /friend-invite-links`         | 產生新連結；舊的未使用連結同時失效 | `201`，`{ token, expiresAt }`       | —                                                                          |
| `POST /friend-invite-links/preview` | body `{ token }`；看是誰產生的     | `200`，`{ inviterName, expiresAt }` | `404 INVITE_LINK_INVALID`                                                  |
| `POST /friend-invite-links/accept`  | body `{ token }`；接受             | `201`，回傳新好友                   | `404 INVITE_LINK_INVALID`、`400 CANNOT_FRIEND_SELF`、`409 ALREADY_FRIENDS` |

- 已經是好友時回 `409`，**連結不被消耗**，產生者之後還能把它交給別人。
- 預覽不消耗連結。

### 好友

| 方法與路徑                 | 說明                                    | 成功            | 錯誤                    |
| -------------------------- | --------------------------------------- | --------------- | ----------------------- |
| `GET /friends`             | `?page=&limit=`，依成為好友的時間新到舊 | `200`，分頁清單 | —                       |
| `DELETE /friends/{userId}` | 解除好友                                | `204`           | `404`（本來就不是好友） |

回應欄位只有 `userId`、`name`、`since`（決策 10）。

### 新增錯誤碼

`CANNOT_FRIEND_SELF`、`ALREADY_FRIENDS`、`FRIEND_REQUEST_PENDING`、`FRIEND_REQUEST_NOT_PENDING`、`INVITE_LINK_INVALID`。`USER_NOT_FOUND` 沿用既有的。

### 同時送達的請求

- 兩個接受動作同時成立同一對好友：`Friendship` 的主鍵擋下第二筆，service 把唯一性錯誤（Prisma `P2002`）轉成 `409 ALREADY_FRIENDS`。
- 兩人同時用同一條連結：以「`usedAt` 為空才更新」的條件式更新消耗連結，只有一人成功，另一人拿到 `404 INVITE_LINK_INVALID`。

---

## 6. 可驗證的成功條件

- **SC-F1**：A 以 B 的 email 送出邀請 → B 的 `incoming` 清單出現 → B 接受 → 雙方 `GET /friends` 都看得到對方。
- **SC-F2**：以未註冊的 email 送出邀請 → `404 USER_NOT_FOUND`，資料庫沒有新增任何一筆。以大小寫不同的寫法輸入已註冊的 email（如 `Bob@Example.com`）→ 找得到。
- **SC-F3**：邀請自己 → `400`；邀請已是好友的人 → `409 ALREADY_FRIENDS`；已有 `PENDING` 邀請時重送 → `409 FRIEND_REQUEST_PENDING`。
- **SC-F4**：B 已邀請 A，A 再邀請 B → 雙方直接成為好友，資料庫只有一筆邀請，狀態 `ACCEPTED`。
- **SC-F5**：B 拒絕 A 的邀請 → A 的 `outgoing` 清單看到 `DECLINED`；A 立刻重送 → 成功，產生一筆新的 `PENDING` 邀請。
- **SC-F6**：授權矩陣——每一種動作（接受、拒絕、取消）× 每一種角色（發起者、收件者、第三人）都有測試，結果符合 §3.3。
- **SC-F7**：連結——產生 → 預覽看到產生者名稱 → 接受 → 成為好友；同一條連結再用一次 → `404`；超過 10 分鐘 → `404`；產生新連結後舊連結 → `404`；接受自己的連結 → `400`。
- **SC-F8**：資料庫裡找不到任何連結 token 的原文。
- **SC-F9**：解除好友後，雙方清單都不再出現對方；之後可以重新邀請；解除一個不是好友的人 → `404`。
- **SC-F10**（SEC-19）：A 與 B 是好友，但 A 不是 B 任何帳本的成員。A 讀取 B 的帳本、交易、帳本成員 → 一律 `404`；A 的帳戶清單不含 B 的帳戶；A 對 B 的帳本加成員 → `404`。
- **SC-F11**：`GET /friends` 的回應不含 email。邀請回應中，唯一出現的 email 是「我送出、尚未被接受的邀請」裡我自己輸入的那個（決策 11）。
- **SC-F12**：同一 IP 一分鐘內第 11 次送出邀請 → `429`。與 auth 端點相同的獨立測試方式。
- **SC-F13**：`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；migration 進版控且重跑無 pending。

---

## 7. 測試策略

- **單元測試**：`FriendsService` 的每個狀態轉換，對照 §3.1；SC-F6 的授權矩陣用表格驅動測試（`it.each`）寫，一列一種組合，漏掉的組合一眼看得出來。
- **e2e**（`apps/api/test/friends.e2e-spec.ts`）：SC-F1～F5、F7、F9 的完整流程；SC-F10 的資料隔離。**SEC-10 要求授權相關測試先於實作存在**，所以 SC-F6 與 SC-F10 的測試在實作前寫好。
- **時間相關**（SC-F7 的 10 分鐘）：service 透過可注入的時鐘取得現在時間，測試裡直接指定，不真的等。
- **流量限制**（SC-F12）：沿用 auth 的做法，在獨立測試中開啟 throttler。

---

## 8. 延後項目

| 項目                   | 說明                                                         | 時機                     |
| ---------------------- | ------------------------------------------------------------ | ------------------------ |
| 封鎖                   | 目前沒有需求。沒有冷卻期，被反覆邀請時只能一再拒絕           | 有實際騷擾回報時         |
| 註冊驗證信             | 真正做到 SEC-11 的「無法判定」的前提。需要寄信的基礎設施     | 有寄信需求時一併處理     |
| 從好友清單挑選帳本成員 | 加成員改為從好友挑選。會改動成員端點的 API                   | 3b 之後，與 Web 畫面一起 |
| 帳本邀請連結           | `phase-2d-ledger-kind.md` §8。可沿用本步的 token 機制        | 待定                     |
| 清理過期連結           | 過期與已使用的連結目前不刪。每筆資料很小，量大了再加排程清理 | 單表超過 10 萬筆時       |

---

## 9. 界線（Always / Ask first / Never）

- **Always**：DTO 驗證；新錯誤碼進 `@ledger/shared`；規則寫在 service；授權測試先於實作（SEC-10）；token 只存雜湊。
- **Ask first**：本 spec 的 schema 變更核可即視為同意，但**手寫的 CHECK 與部分唯一索引 SQL 要在套用前給開發者看過**。任何對 `LedgerAccessGuard` 的改動都要先說明——本步預期不需要動它。
- **Never**：讓好友關係影響任何帳本、帳戶、交易的權限；在資料庫或日誌中存放連結 token 原文；把 token 放進 URL 路徑；在好友清單回傳 email。

---

## 10. Step 拆分概觀（核可後寫入 `tasks/`）

1. **shared 契約**：型別、錯誤碼、分頁回應格式。
2. **schema + migration**：三張表、一個 enum、手寫的 CHECK 與部分唯一索引。
3. **授權測試先行**：SC-F6 的矩陣與 SC-F10 的隔離測試（此時應該是紅的）。
4. **好友邀請**：service 與 controller，含決策 8、9。
5. **邀請連結**：token 產生、雜湊、條件式消耗。
6. **好友清單與解除好友**。
7. **流量限制與收尾**：SC-F12、OpenAPI 標註、對照 SC-F1～F13 驗收。
