# Spec：階段二 (2c) — 帳戶與餘額

> 狀態：**草案，待開發者審核**（2026-08-12）
> 依據：2026-08-12 的設計訪談（grilling）逐題定案，詳見下方 §2 決策清單。
> 定位：**取代 2a 的付款方式**。前端 Slice 2（分類/付款方式管理頁）必須排在本步之後，否則會建出即將被丟棄的畫面。
> 執行順序：2b Slice 0（已完成）→ **本步（2c 後端）** → 2b Slice 1 之後各切片（含帳本連動設定的 UI）。

---

## 1. 目標與成功樣貌

把「付款方式」（一個沒有語意的標籤）升級為「**帳戶**」：錢實際放在哪裡、還剩多少。使用者能看到每個帳戶的即時餘額，並用「轉帳」記錄帳戶之間的資金移動。

### 範圍內

- 新增 `Account`（屬於**使用者**，跨帳本共用）與其 CRUD。
- 餘額**即時計算**（不儲存），含初始餘額。
- 交易新增 `TRANSFER` 型別與「轉入帳戶」。
- 帳本新增「**是否與我的帳戶連動**」設定與「**封存**」。
- 移除 `PaymentMethod`（破壞性遷移）。
- `@ledger/shared` 型別、錯誤碼；單元與 e2e 測試。

### 範圍外（見 §8 延後清單）

- 公共 / 共享帳戶（多人共用一個帳戶）。
- 分攤 / 代墊 / 借還帳。
- 帳戶型別與信用卡結算日等欄位。
- 多幣別與跨幣別轉帳。
- 統計 / 報表 / 圖表（統計卡片仍維持「即將推出」）。
- 前端畫面（本步為純後端；UI 併入後續切片）。

---

## 2. 已定案的決策（訪談逐題結論）

| #   | 決策                                                   | 理由摘要                                                                           |
| --- | ------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 1   | 帳戶屬於**使用者**，非帳本                             | 同一張信用卡若綁帳本，在多個帳本要各建一次、餘額各算各的，**必定是錯的**           |
| 2   | 餘額**即時算出**，不儲存                               | 儲存欄位只要有一條路徑忘了更新就永久失準且難以察覺；算出來的不可能失準             |
| 3   | 連動帳本的交易**必填帳戶**（預設現金）                 | 可以不填就代表餘額只是「部分真實」，等於不能信                                     |
| 4   | 轉帳＝新增 `TRANSFER` 型別                             | 一筆＝一件事，不會有孤兒或金額不一致；改用兩筆連動交易則統計時忘記排除就會灌水     |
| 5   | **不分帳戶型別**，餘額可為負                           | 負數已足以正確表達信用卡欠款；型別是顯示需求，日後 nullable 加法補上即可           |
| 6   | 初始餘額用 `initialBalance` 欄位                       | 用「期初餘額交易」會讓假交易混進列表與收入統計                                     |
| 7   | 個人帳戶**對其他帳本成員隱藏**                         | 帳戶名稱可能敏感；協作需要的是金額與分類，不是「你從哪個戶頭付的」                 |
| 8   | 共享帳本中任何 EDITOR 仍可編輯任何交易                 | 維持現狀；共享帳本的前提是彼此信任，且有 `creator` 可追溯                          |
| 9   | 帳本新增「是否與帳戶連動」，**建立後不可變更**         | 事後變更會讓餘額突然跳動；非連動帳本適用於臨時出遊、社團公款等「錢不是我的」情境   |
| 10  | 非連動帳本的交易**不填帳戶**                           | 不影響餘額，帳戶欄位沒有意義；也讓臨時記帳更快                                     |
| 11  | **封存取代刪除**；僅當帳本內無其他成員的交易時才可真刪 | 別人刪掉共享帳本會讓你的餘額回溯性改變；封存根除此問題，但仍允許收拾自己建錯的帳本 |
| 12  | 跨帳本統計預設只計**連動帳本**                         | 非連動帳本的金額不代表你的支出                                                     |
| 13  | 破壞性遷移，移除 `PaymentMethod`                       | 付款方式綁帳本、帳戶綁使用者，對不起來；保留只會產生大量重複帳戶待手動合併         |
| 14  | 帳戶**不帶幣別**                                       | 沿用階段一「只支援 TWD」前提                                                       |

### 已知的近似（刻意接受）

非連動帳本中，你先墊付的金額不影響餘額。若你把「自己的那一份」另外記進個人帳本，帳面餘額會**高於**真實現金，差額**恰等於別人欠你的錢**；等對方還清（且**不把還款記成收入**）帳就自動對上。若對方不還，把該金額記成一筆支出即可。

階段三的分攤與債務物件，就是把這個「影子」變成看得見、算得準的東西。

---

## 3. 可驗證的成功條件

- **SC-C1**：註冊後自動取得預設帳戶（現金 / 銀行 / 信用卡）。
- **SC-C2**：`GET /accounts` 只回傳自己的帳戶，且每筆附帶**即時計算**的餘額。
- **SC-C3**：帳戶可新增 / 改名 / 調整初始餘額 / 刪除；同一使用者下名稱唯一（重複 409）。
- **SC-C4**：有交易引用（含軟刪除交易）的帳戶不可刪除（409）。
- **SC-C5**：在**連動**帳本建立交易時未給 `accountId` → 400；給了**別人的**帳戶 → 404（不洩漏存在性）。
- **SC-C6**：在**非連動**帳本建立交易時給 `accountId` → 400。
- **SC-C7**：`TRANSFER` 交易需 `accountId` 與 `toAccountId`（兩者皆屬自己、且不相同），且**不得帶 `categoryId`**；`EXPENSE`/`INCOME` 則 `categoryId` 必填。
- **SC-C8**：餘額正確反映：初始餘額、收入、支出、轉出、轉入；且**排除軟刪除交易與非連動帳本**。
- **SC-C9**：共享帳本中，成員看不到其他人交易的帳戶（回應為 `null`），但看得到金額、分類與記帳者。
- **SC-C10**：帳本可封存；封存後不可再記帳，且預設不出現在帳本列表。
- **SC-C11**：帳本內有其他成員的交易時，刪除回 409（只能封存）；沒有時可刪除。
- **SC-C12**：`tracksBalance` 於建立後不可變更（嘗試變更回 400）。
- **SC-C13**：`pnpm lint / typecheck / test / build` 與 e2e 全綠；migration 進版控且重跑無 pending。

---

## 4. 資料模型（Prisma）

```prisma
enum TransactionType {
  EXPENSE
  INCOME
  TRANSFER // 新增：帳戶之間的資金移動，不計入收入或支出
}

model Account {
  id             String   @id @default(uuid())
  userId         String
  name           String
  /// 開始使用本系統時該帳戶已有的金額；可為負（例如信用卡既有欠款）
  initialBalance Int      @default(0)
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  user              User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions      Transaction[] @relation("TransactionAccount")
  incomingTransfers Transaction[] @relation("TransactionToAccount")

  @@unique([userId, name]) // 同一使用者下名稱唯一
}

model Ledger {
  // ...既有欄位不動...
  /// 此帳本的交易是否計入我的帳戶餘額。建立後不可變更。
  tracksBalance Boolean   @default(true)
  /// 封存時間；封存後不可再記帳，預設不列於帳本清單
  archivedAt    DateTime?
}

model Transaction {
  // ...既有欄位不動，但有兩處變更...
  /// 連動帳本必填、非連動帳本必為 null（由 service 把關）
  accountId   String?
  /// 僅 TRANSFER 使用：轉入的帳戶
  toAccountId String?
  /// 改為可空：TRANSFER 沒有分類
  categoryId  String?

  account   Account?  @relation("TransactionAccount", fields: [accountId], references: [id])
  toAccount Account?  @relation("TransactionToAccount", fields: [toAccountId], references: [id])
  category  Category? @relation(fields: [categoryId], references: [id])

  @@index([accountId])
  @@index([toAccountId])
}
```

- `PaymentMethod` model 與 `Transaction.paymentMethodId` **移除**。
- 帳戶對交易採預設的 `Restrict`：有引用時不可刪（由 service 先行檢查並回 409，DB 為後盾）。
- `Account → User` 用 `Cascade`：使用者刪除時其帳戶一併移除。

### 餘額計算

```
餘額 = initialBalance
     + Σ INCOME   (accountId = A)
     − Σ EXPENSE  (accountId = A)
     − Σ TRANSFER (accountId = A)      // 轉出
     + Σ TRANSFER (toAccountId = A)    // 轉入
```

所有加總皆排除 `deletedAt != null`，且只計 `ledger.tracksBalance = true` 的交易。

---

## 5. API 設計

### Accounts（**使用者範圍**，不在 `/ledgers/:id` 之下）

| 方法   | 路徑             | 說明                                             |
| ------ | ---------------- | ------------------------------------------------ |
| GET    | `/accounts`      | 自己的帳戶清單，每筆含即時餘額                   |
| POST   | `/accounts`      | 新增 `{ name, initialBalance? }`（重複名稱 409） |
| PATCH  | `/accounts/{id}` | 改名 / 調整初始餘額                              |
| DELETE | `/accounts/{id}` | 刪除（有交易引用時 409）                         |

- 授權：僅需 JWT；一律以 `userId = 目前使用者` 過濾，**存取他人帳戶一律 404**。不需要 `LedgerAccessGuard`。

### Transactions（既有端點，行為擴充）

- `create` / `update` 接受 `accountId`、`toAccountId`；`categoryId` 改為條件必填。
- 驗證規則（service）：
  - 連動帳本：`accountId` 必填且須屬於呼叫者（否則 404）；非連動帳本：`accountId` 必須不存在（否則 400）。
  - `TRANSFER`：`toAccountId` 必填、須屬呼叫者、且不得等於 `accountId`；`categoryId` 必須不存在。
  - `EXPENSE` / `INCOME`：`categoryId` 必填（同現況）。
- 回應新增 `account` 與 `toAccount`；**若該帳戶不屬於呼叫者則回 `null`**（§2 決策 7 的隱私規則）。

### Ledgers（既有端點，行為擴充）

| 方法   | 路徑                    | 說明                                                        |
| ------ | ----------------------- | ----------------------------------------------------------- |
| POST   | `/ledgers`              | 新增 `tracksBalance`（預設 `true`）                         |
| GET    | `/ledgers`              | 預設排除已封存；`?includeArchived=true` 可包含              |
| POST   | `/ledgers/{id}/archive` | 封存（OWNER）                                               |
| DELETE | `/ledgers/{id}`         | 僅當帳本內無**其他成員**的交易時允許；否則 409 引導改用封存 |
| PATCH  | `/ledgers/{id}`         | 嘗試變更 `tracksBalance` → 400                              |

- 封存後：該帳本的寫入端點一律 409（唯讀）。

### 新增錯誤碼

`ACCOUNT_NAME_TAKEN`、`ACCOUNT_IN_USE`、`ACCOUNT_REQUIRED`、`ACCOUNT_NOT_ALLOWED`、`TRANSFER_SAME_ACCOUNT`、`LEDGER_ARCHIVED`、`LEDGER_HAS_OTHERS_TRANSACTIONS`、`TRACKS_BALANCE_IMMUTABLE`。
（跨使用者 / 不存在的帳戶沿用 `NOT_FOUND`。）

---

## 6. 遷移計畫（破壞性）

> ⚠️ 僅適用於目前「只有開發測試資料」的狀態；正式上線後不可如此處理。

1. 建立 `Account` 表；`Ledger` 加 `tracksBalance`、`archivedAt`；`TransactionType` 加 `TRANSFER`。
2. `Transaction` 加 `accountId`、`toAccountId`；`categoryId` 改為 nullable。
3. **資料轉換**：為每位既有使用者建立預設帳戶（現金 / 銀行 / 信用卡）；把既有交易的 `accountId` 指向**其 `creatorId` 所對應使用者的「現金」帳戶**（既有帳本 `tracksBalance` 皆為預設 `true`）。
4. 移除 `Transaction.paymentMethodId` 與 `PaymentMethod` 表。
5. 移除 `PaymentMethodsModule` 與相關 shared 型別 / 錯誤碼 / 測試。

---

## 7. 測試策略

- **單元（AccountsService）**：重複名稱 409、跨使用者存取 404、有引用不可刪、餘額計算（含初始餘額、四種加減、排除軟刪除與非連動帳本）。
- **單元（TransactionsService）**：連動帳本缺帳戶 400、非連動帳本給帳戶 400、他人帳戶 404、TRANSFER 的三條規則、`categoryId` 條件必填。
- **單元（LedgersService）**：封存後不可寫入、`tracksBalance` 不可變更、刪除的兩種結果。
- **e2e**：註冊帶預設帳戶；建立連動 / 非連動帳本各記一筆並驗餘額；轉帳後兩邊餘額；共享帳本中他人交易的帳戶為 `null`；封存流程。
- 授權與隱私路徑（他人帳戶、他人交易的帳戶欄位）**必須有測試覆蓋**。

---

## 8. 延後項目（本階段不做，但已定調）

| 項目                               | 說明                                                                                                                                              | 時機           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **公共 / 共享帳戶**                | 家庭、夫妻、情侶、社團的共同資金。做法：`Account` 加成員關聯表（比照 `LedgerMember`）。與「分帳」是不同的東西——共享帳戶有真實的共同資金，分帳沒有 | 階段三之後評估 |
| **分攤 / 代墊 / 借還帳**           | 「我付 3000，其中 500 是我的，2500 是別人欠我的」。**不限共享帳本，個人帳本同樣適用**                                                             | **階段三**     |
| **帳戶型別與型別專屬欄位**         | `AccountType`（現金/銀行/信用卡…）、信用卡結算日 / 繳款日。做法：nullable 欄位，純加法 migration                                                  | 有需求時       |
| **「把我的部分記到個人帳本」捷徑** | 資料模型已支援（就是新增一筆交易）；只差 UI 捷徑。刻意**不建立兩筆之間的關聯**                                                                    | Slice 1 之後   |
| **封存時的消費規整**               | 把自己的消費搬到其他帳本。需要分攤資訊才知道該搬多少，否則金額會錯                                                                                | 階段三之後     |
| **跨帳本「我的交易」視角**         | 依「帳戶屬於我」篩選，天然跨帳本                                                                                                                  | 前端切片       |
| **統計 / 報表 / 圖表**             | 需要後端彙總端點；統計卡片目前顯示「即將推出」                                                                                                    | 待定           |
| **多幣別與跨幣別轉帳**             | 涉及匯率，是獨立題目                                                                                                                              | 待定           |

---

## 9. 界線（Always / Ask first / Never）

- **Always**：DTO 驗證；帳戶一律以 `userId` 過濾（deny by default）；schema 變更走 migration；新錯誤碼進 shared。
- **Ask first**：本步的 schema / API 變更已於訪談取得同意；**破壞性資料遷移需再次確認**後才執行。
- **Never**：儲存餘額（決策 2）；讓餘額把非連動帳本或軟刪除交易算進去；洩漏他人帳戶的存在或名稱；金額用浮點數。

---

## 10. Step 拆分概觀（核可後寫入 `tasks/`）

1. **shared 契約**：`Account` 型別、`TRANSFER`、交易與帳本型別調整、預設帳戶常數、錯誤碼。
2. **schema + 破壞性 migration**：新表、新欄位、資料轉換、移除 `PaymentMethod`。
3. **AccountsModule**：CRUD + 餘額計算。
4. **交易整合**：條件必填規則、TRANSFER、隱私過濾。
5. **帳本整合**：`tracksBalance`、封存、刪除規則。
6. **測試補完與最終驗收**（對照 SC-C1～SC-C13）。
