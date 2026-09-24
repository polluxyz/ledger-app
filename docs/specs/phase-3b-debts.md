# Spec：階段三 (3b) — 借還帳

> 狀態：**3b-1 已實作，3b-2 未開始**（2026-09-24；開發者表示不完備處等實際成果出來再調整）
> 依據：`專案決策脈絡.md`「階段三定案」（2026-09-23），加上 2026-09-24 的假設清單確認，詳見 §2。
> 定位：**後端為主**。Web 只做讓既有畫面不壞的最小相容改動（§7），借還帳的畫面另立步驟。
> 前置：3a 好友系統（PR #54）已合併。
> 執行順序：3a（已完成）→ 3b-1 單邊借還（已完成）→ **3b-1 的 Web 畫面** → 3b-2 連動 → 3b-2 的 Web 畫面（含好友畫面）。代墊另開一輪設計，不在本步。
> 順序在 2026-09-24 調整過：3b-1 的 Web 畫面提前到 3b-2 之前，理由見 §11。

---

## 1. 目標與成功樣貌

讓使用者記錄「誰欠誰多少錢」，並讓帳戶餘額反映借出與借入。

本步完成後，使用者可以：

1. 記一筆借出或借入，錢從哪個帳戶出去或進來，就跟一般支出一樣選。
2. 分多次記錄還款，未清餘額自動算出，還清就自動結清。
3. 對方不還時，把剩下的金額免除。
4. 查「每個人跟我之間的淨額」：誰欠我多少、我欠誰多少。
5. 對方是好友時，把自己這筆債務**連動**給對方。對方接受後，雙方各有一份記錄，之後的還款、改金額、免除都會送提議給對方確認。

### 範圍內

- 4 種新交易型別與餘額計算（§4.1）。
- 債務、還款、免除、刪除、每人淨額（3b-1）。
- 連動請求、變更提議、解除連動、解除好友時自動解除連動（3b-2）。
- 授權模型（SEC-20 中與借還有關的部分）、SEC-12 與 SEC-13 的狀態機。
- `@ledger/shared` 型別與錯誤碼；單元測試與 e2e 測試。
- Web 的最小相容改動（§7）。

### 範圍外（見 §9）

- 代墊（一筆消費拆給多人）。開發者 2026-09-23 決定另開一輪設計。
- 借還帳的 Web 畫面。3b-1 的畫面另立 spec（`phase-3b1-web.md`）；連動的畫面在 3b-2 之後。
- 對方日後註冊時，把單邊記錄升級成連動。
- 多幣別。

---

## 2. 已定案的決策

### 2.1 延續 2026-09-23 的定案

| #   | 決策                                                                                            |
| --- | ----------------------------------------------------------------------------------------------- |
| 1   | 只做雙人借還。代墊另開一輪                                                                      |
| 2   | 新增 4 種交易型別：`LEND` 借出、`BORROW` 借入、`COLLECT` 收回、`REPAY` 償還。資金方向由型別決定 |
| 3   | 使用者不挑型別：建立時說「我借出／我借入」，記還款時系統依角色決定 `COLLECT` 或 `REPAY`         |
| 4   | 這 4 種交易只能從債務端點建立與修改                                                             |
| 5   | 未清餘額用算的：本金減去所有還款，不存欄位                                                      |
| 6   | 對方不是使用者時做單邊記錄，只存名字；不做日後升級成連動                                        |
| 7   | 舊債可以只建債務、不產生交易                                                                    |
| 8   | 債權人可免除剩餘金額；免除不產生交易                                                            |
| 9   | 個人記帳優先：債務一建立就存在於建立者這一側                                                    |
| 10  | 對方拒絕連動，建立者的記錄照樣保留                                                              |
| 11  | 對方接受時自己選記進哪個帳本                                                                    |
| 12  | 解除好友時，連動中的債務自動轉成雙方各自的單邊記錄                                              |
| 13  | 鏡像交易可以記進多人共享帳本；帳本其他成員看得到交易，看不到背後的債務                          |
| 14  | 連動請求要有流量限制                                                                            |

### 2.2 2026-09-24 新定案

| #   | 決策                                                                             | 理由摘要                                                                 |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 15  | **連動＝各記各的，互相送提議**。每人一份自己的債務，連動只是把兩份配成一對       | 拒絕、解除好友、刪除都只是拆掉配對，兩份各自留著，與「個人記帳優先」同形 |
| 16  | **還款立刻從自己的帳戶扣**，對方那邊收到待確認的提議                             | 錢已經離開口袋，帳就該反映。對方確認前兩邊不一致，由系統標出差異         |
| 17  | 債務屬於**使用者**，不屬於帳本。它產生的交易放在使用者選的帳本，需要 EDITOR 以上 | 與帳戶同理：同一筆債務的借出與還款可能記在不同帳本                       |
| 18  | 每筆還款各自選帳本與帳戶，預設與借出時相同                                       | 原帳本封存後仍能記還款                                                   |
| 19  | 可以記進不連動帳本（`tracksBalance = false`），這時交易不填帳戶                  | 與現有交易規則一致                                                       |
| 20  | 還款與免除是債務本身的紀錄，交易只是附帶的                                       | 舊債可以沒有交易，未清餘額依然算得出來                                   |
| 21  | 帳本內有借還交易時**不能真刪，只能封存**（`409 LEDGER_HAS_DEBT_TRANSACTIONS`）   | 真刪會 cascade 刪掉交易，讓債務與帳戶對不起來                            |
| 22  | 借還交易出現在交易列表，但**不算收入也不算支出**                                 | 借出的錢會回來，不是花掉                                                 |
| 23  | 刪除自己那份債務：連同它的交易一起軟刪除；有連動就等同解除連動                   | 對方那份是對方的記錄，不因我刪除而消失                                   |
| 24  | 只有**好友**能收到連動請求；單邊記錄的對象可填任意名字                           | 連動會把我的名字與金額送到對方面前，需要既有的社交關係                   |
| 25  | 同一筆債務的連動請求最多送 **3 次**；請求不會自動過期                            | 防止對拒絕的人反覆騷擾                                                   |
| 26  | 解除好友時，還沒回應的連動請求與提議一律取消                                     | 延伸決策 12                                                              |
| 27  | 提供「每人淨額」查詢                                                             | 借還帳最常看的就是這一個數字                                             |
| 28  | 免除不可撤銷                                                                     | 撤銷會讓對方已確認的免除失去依據                                         |
| 29  | 只支援 TWD                                                                       | 沿用階段一前提                                                           |

### 2.3 兩條舊規則在決策 15 下的新解讀

2026-09-23 定案時，連動的形狀還沒決定。決策 15 定下之後，下面兩條要換一種說法，意思沒有打折：

- **「對自己不利的主張不需對方確認」**：在「各記各的」之下，每個人本來就能直接改自己那一份，這條不再需要特別規定。它原本想防止的事（有人單方面宣稱對自己有利的事）同樣防得住：你的主張只會改你自己的記錄，要改對方的記錄一律要對方確認。
- **「連動後要改金額，必須對方重新確認」**：改成「改金額會送一個提議給對方」。我的記錄立刻改，對方的記錄等對方確認。

兩邊不一致時，系統**不裁決誰對**，只把差異標出來（§5.5 的 `counterpart`）。這與「個人記帳優先」一致：帳本反映的是記帳者自己知道的事。

---

## 3. 概念與狀態

### 3.1 名詞

| 名詞     | 意思                                                               |
| -------- | ------------------------------------------------------------------ |
| 債務     | 一個人記下的「我借出了／我借入了」。永遠只屬於一個人（**擁有者**） |
| 本金     | 最初借出或借入的金額                                               |
| 還款     | 對一筆債務的部分或全部清償。可多次                                 |
| 未清餘額 | 本金減去所有還款。**算出來的，不存欄位**                           |
| 連動     | 兩人各一份的債務被配成一對。之後一方的變更會送提議給另一方         |
| 連動請求 | 擁有者邀請一位好友把這筆債務記進對方帳上                           |
| 提議     | 連動後一方做了變更（還款、改金額、免除），送給另一方確認的請求     |
| 對方     | 債務記錄上的另一個人。單邊時只是一個名字；連動時是一位使用者       |

### 3.2 債務的狀態（算出來的）

| 狀態       | 條件                   | 可以做的事                              |
| ---------- | ---------------------- | --------------------------------------- |
| `OPEN`     | 未免除，且未清餘額 > 0 | 記還款、改內容、免除、連動、刪除        |
| `SETTLED`  | 未免除，且未清餘額 = 0 | 刪除還款（會回到 `OPEN`）、改備註、刪除 |
| `FORGIVEN` | 已免除                 | 改備註、刪除                            |

還款金額不得超過當下的未清餘額，超過回 `409 DEBT_OVERPAYMENT`。同理，把本金改得比已還總額還小（自己改，或接受對方的 `AMEND` 提議）也回 `409 DEBT_OVERPAYMENT`。

### 3.3 連動請求的狀態（SEC-12）

```
               接受（收件者）
          ┌──────────────────▶ ACCEPTED ──解除（任一方）／解除好友（系統）──▶ UNLINKED
          │  拒絕（收件者）
PENDING ──┼──────────────────▶ DECLINED
          │  取消（發起者）／發起者刪除債務／解除好友（系統）
          └──────────────────▶ CANCELLED
```

- 同一筆債務同時最多一個 `PENDING` 或 `ACCEPTED` 的請求。
- `DECLINED` 或 `CANCELLED` 之後可以重送，**每筆債務總共最多 3 次**（決策 25），第 4 次回 `409 DEBT_LINK_LIMIT_REACHED`。
- 已結束的狀態不能再轉換，回 `409 DEBT_LINK_NOT_PENDING`。

| 轉換              | 誰能觸發                                           |
| ----------------- | -------------------------------------------------- |
| 建立（`PENDING`） | 債務擁有者，對象必須是好友                         |
| → `ACCEPTED`      | 收件者，同時選擇帳本與帳戶，或不產生交易           |
| → `DECLINED`      | 收件者                                             |
| → `CANCELLED`     | 發起者；或系統（見上圖）                           |
| → `UNLINKED`      | 任一方；或系統（解除好友、任一方刪除自己那份債務） |

### 3.4 提議的狀態（SEC-13）

連動後，一方對自己那份做了下列變更，系統就送一個提議給另一方：

| 變更                   | 提議種類  | 對方接受後，對方那份會怎樣                                   |
| ---------------------- | --------- | ------------------------------------------------------------ |
| 記一筆還款             | `PAYMENT` | 加一筆還款；對方選帳本與帳戶，或不產生交易                   |
| 改本金或日期           | `AMEND`   | 本金與日期改成提議的值；若有本金交易，交易的金額與日期一起改 |
| 免除（只有債權人能做） | `FORGIVE` | 對方那份也標成免除                                           |

- 狀態：`PENDING` → `ACCEPTED` / `DECLINED`（收件者），或 `CANCELLED`（系統：解除連動時）。
- 提議只寫對方的記錄，不改發起者自己的記錄（發起者那份在送出時就已經改好了，決策 16）。
- 對方拒絕提議，兩邊就會不一致。系統不重送，也不裁決。
- 接受 `PAYMENT` 時若會讓對方那份超額還款，回 `409 DEBT_OVERPAYMENT`，提議維持 `PENDING`，對方可以改拒絕。
- **不同步的變更**：刪除還款、改備註。備註是各自的，本來就不同步；刪除還款屬於更正自己的記錄，不送提議，差異會顯示在 `counterpart`。

### 3.5 誰能做什麼（SEC-20 的借還部分）

| 角色                 | 能做                                                                 | 不能做                                                                            |
| -------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 債務**擁有者**       | 讀取、修改、記還款、免除（限債權人）、刪除、送連動請求、解除連動     | —                                                                                 |
| 連動的**對方**       | 讀取**自己那一份**；在自己那份看到對方的顯示名稱與對方那份的未清餘額 | 讀取或修改對方那份的其他內容（備註、帳本、帳戶、交易），回 `404`                  |
| 連動請求的**收件者** | 看到發起者的顯示名稱、方向、本金、日期；接受、拒絕                   | 看到發起者的備註、帳本、帳戶                                                      |
| 連動請求的**發起者** | 取消 `PENDING` 的請求                                                | 接受或拒絕自己的請求（`403`）                                                     |
| 提議的**收件者**     | 接受、拒絕                                                           | —                                                                                 |
| 提議的**發起者**     | 看自己送出的提議                                                     | 接受或拒絕自己的提議（`403`）                                                     |
| 其他任何人           | 無                                                                   | 讀取或操作任何債務、請求、提議（`404`）                                           |
| **帳本成員**         | 看到記在該帳本的借還交易（決策 13）                                  | 從交易追到背後的債務：交易回應裡的 `debtId` 只對債務擁有者有值，其他成員是 `null` |

另外兩條原有規則照樣適用，不因借還而放寬：

- 把交易記進某帳本，要有該帳本的 EDITOR 以上權限，且帳本未封存。
- 指定的帳戶必須屬於呼叫者本人。

---

## 4. 資料模型（Prisma）

> 依 `CLAUDE.md` §14，schema 變更屬於「先說明再做」。本節核可即視為同意；migration 裡的手寫 SQL 仍要在套用前給開發者看過。

### 4.1 交易型別與餘額

```prisma
enum TransactionType {
  EXPENSE
  INCOME
  TRANSFER
  LEND     // 借出：錢從帳戶出去
  BORROW   // 借入：錢進到帳戶
  COLLECT  // 收回：債權人收到還款，錢進到帳戶
  REPAY    // 償還：債務人還錢，錢從帳戶出去
}
```

餘額計算（`accounts.service.ts`）改成**逐一列舉每個型別**，漏處理的型別在 typecheck 就會失敗：

| 型別                          | 對 `accountId` 的影響  |
| ----------------------------- | ---------------------- |
| `INCOME`、`BORROW`、`COLLECT` | 加                     |
| `EXPENSE`、`LEND`、`REPAY`    | 減                     |
| `TRANSFER`                    | 轉出減、轉入加（不變） |

借還交易**沒有分類**（`categoryId` 為 `null`），與轉帳相同。

### 4.2 新增的 model

```prisma
enum DebtDirection {
  LENT      // 我借出：我是債權人
  BORROWED  // 我借入：我是債務人
}

enum DebtLinkStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
  UNLINKED
}

enum DebtProposalKind {
  PAYMENT
  AMEND
  FORGIVE
}

enum DebtProposalStatus {
  PENDING
  ACCEPTED
  DECLINED
  CANCELLED
}

/// 一個人記下的一筆債務。永遠只屬於一位擁有者（決策 15）。
model Debt {
  id               String        @id @default(uuid())
  ownerId          String
  direction        DebtDirection
  /// 對方的名字。單邊時是擁有者輸入的；連動時是接受當下對方的顯示名稱（快照）。
  counterpartyName String
  principal        Int           // 最小貨幣單位，> 0
  date             DateTime
  note             String?
  /// 本金那筆 LEND / BORROW 交易。舊債可為 null（決策 7）。
  transactionId    String?       @unique
  forgivenAt       DateTime?
  deletedAt        DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt

  owner       User          @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  transaction Transaction?  @relation("DebtPrincipal", fields: [transactionId], references: [id], onDelete: Restrict)
  payments    DebtPayment[]
  linksSent   DebtLink[]    @relation("DebtLinkRequester")
  linkReceived DebtLink?    @relation("DebtLinkRecipient")

  @@index([ownerId, deletedAt])
}

/// 一筆還款。未清餘額 = 本金 − Σ 未刪除的還款。
model DebtPayment {
  id            String    @id @default(uuid())
  debtId        String
  amount        Int       // > 0
  date          DateTime
  note          String?
  /// COLLECT / REPAY 交易。可為 null（接受提議時選擇不產生交易）。
  transactionId String?   @unique
  deletedAt     DateTime?
  createdAt     DateTime  @default(now())

  debt        Debt         @relation(fields: [debtId], references: [id], onDelete: Cascade)
  transaction Transaction? @relation("DebtPaymentTransaction", fields: [transactionId], references: [id], onDelete: Restrict)

  @@index([debtId])
}

/// 連動請求，也是連動關係本身：ACCEPTED 就代表兩份債務正配成一對。
model DebtLink {
  id              String         @id @default(uuid())
  requesterDebtId String
  requesterId     String
  recipientId     String
  /// 接受時為收件者建立的那一份。
  recipientDebtId String?        @unique
  status          DebtLinkStatus @default(PENDING)
  respondedAt     DateTime?
  unlinkedAt      DateTime?
  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt

  requesterDebt Debt  @relation("DebtLinkRequester", fields: [requesterDebtId], references: [id], onDelete: Cascade)
  recipientDebt Debt? @relation("DebtLinkRecipient", fields: [recipientDebtId], references: [id], onDelete: SetNull)
  requester     User  @relation("DebtLinkSent", fields: [requesterId], references: [id], onDelete: Cascade)
  recipient     User  @relation("DebtLinkReceived", fields: [recipientId], references: [id], onDelete: Cascade)
  proposals     DebtProposal[]

  @@index([recipientId, status])
  @@index([requesterId, status])
}

/// 連動後一方的變更，送給另一方確認。
model DebtProposal {
  id           String             @id @default(uuid())
  linkId       String
  fromUserId   String
  toUserId     String
  kind         DebtProposalKind
  /// PAYMENT：還款金額；AMEND：新的本金。FORGIVE 為 null。
  amount       Int?
  /// PAYMENT：還款日；AMEND：新的日期。FORGIVE 為 null。
  date         DateTime?
  status       DebtProposalStatus @default(PENDING)
  respondedAt  DateTime?
  createdAt    DateTime           @default(now())

  link DebtLink @relation(fields: [linkId], references: [id], onDelete: Cascade)

  @@index([toUserId, status])
}
```

`Transaction` 與 `User` 補上對應的反向關聯。`Transaction` 本身**不加欄位**：交易屬於哪筆債務，由 `Debt.transactionId` 與 `DebtPayment.transactionId` 反查。

### 4.3 Prisma 表達不了、要在 migration 手寫的約束

1. `CHECK (principal > 0)`（`Debt`）、`CHECK (amount > 0)`（`DebtPayment`）。
2. `DebtLink` 的部分唯一索引：同一個 `requesterDebtId`，`status IN ('PENDING','ACCEPTED')` 最多一筆。
3. `DebtProposal` 的 CHECK：`kind = 'FORGIVE'` 時 `amount` 與 `date` 為 null，其餘兩種兩者皆非 null。

### 4.4 為什麼交易不加 `debtId` 欄位

債務與交易是一對一（本金）或一對一（每筆還款）。把外鍵放在債務那一側，「一筆交易最多屬於一筆債務」由 `@unique` 保證；放在交易那一側則要多一條約束才擋得住兩筆債務指向同一筆交易。反查只發生在列交易時補 `debtId`，量很小。

---

## 5. API 設計

全部需要登入。新增 `DebtsModule`，放在 `apps/api/src/debts/`。

### 5.1 債務（3b-1）

| 方法與路徑                                | 說明                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `POST /debts`                             | 建立。body 見下                                                            |
| `GET /debts`                              | 我的債務清單。`?status=OPEN\|SETTLED\|FORGIVEN&page=&limit=`，依日期新到舊 |
| `GET /debts/summary`                      | 每人淨額（§5.4）                                                           |
| `GET /debts/{id}`                         | 單筆，含還款列表與連動資訊                                                 |
| `PATCH /debts/{id}`                       | 改本金、日期、備註、對方名字（連動中不可改對方名字）。本金交易一起改       |
| `DELETE /debts/{id}`                      | 軟刪除，連同交易；有連動就解除（決策 23）                                  |
| `POST /debts/{id}/payments`               | 記還款。型別由方向決定：`LENT` → `COLLECT`，`BORROWED` → `REPAY`           |
| `DELETE /debts/{id}/payments/{paymentId}` | 軟刪除還款，連同交易                                                       |
| `POST /debts/{id}/forgive`                | 免除。只限 `LENT` 且 `OPEN`                                                |

建立與記還款共用「要不要產生交易」的欄位：

```ts
// POST /debts
{
  direction: 'LENT' | 'BORROWED';
  counterpartyName: string;       // 1～100 字
  principal: number;              // 正整數
  date: string;                   // ISO 8601
  note?: string;
  record?: { ledgerId: string; accountId?: string };  // 省略 = 不產生交易（舊債）
}

// POST /debts/{id}/payments
{
  amount: number;
  date: string;
  note?: string;
  record?: { ledgerId: string; accountId?: string };  // 省略 = 沿用本金交易的帳本與帳戶；本金沒有交易時 = 不產生交易
}
```

`record` 的規則與一般交易相同：帳本需 EDITOR 以上且未封存；連動帳本必填 `accountId`、非連動帳本不可填；帳戶必須屬於呼叫者。

### 5.2 連動（3b-2）

| 方法與路徑                          | 說明                                                             |
| ----------------------------------- | ---------------------------------------------------------------- |
| `POST /debts/{id}/link`             | body `{ friendUserId }`；送連動請求                              |
| `POST /debts/{id}/unlink`           | 解除連動（任一方都可以對自己那份呼叫）                           |
| `GET /debt-links`                   | `?direction=incoming\|outgoing&status=&page=&limit=`             |
| `POST /debt-links/{id}/accept`      | body `{ record?: { ledgerId, accountId? } }`                     |
| `POST /debt-links/{id}/decline`     | 收件者拒絕                                                       |
| `POST /debt-links/{id}/cancel`      | 發起者取消                                                       |
| `GET /debt-proposals`               | `?direction=incoming\|outgoing&status=&page=&limit=`             |
| `POST /debt-proposals/{id}/accept`  | body `{ record?: { ledgerId, accountId? } }`（只用於 `PAYMENT`） |
| `POST /debt-proposals/{id}/decline` | 收件者拒絕                                                       |

- 送連動請求、接受連動請求：每 IP 每分鐘 10 次，與 3a 同一套限制。
- 接受連動請求時，收件者那份的建立方式：方向相反、本金與日期相同、`counterpartyName` 為發起者的顯示名稱。發起者那份**在接受當下已有的還款**，一併複製成收件者那份的還款，但**不產生交易**——那些錢當時有沒有經過收件者的帳戶，只有收件者自己知道。
- 發起者那份的 `counterpartyName` 在接受時更新為收件者的顯示名稱。

### 5.3 交易端點的調整（既有端點）

- `POST` / `PATCH /ledgers/{id}/transactions` 的 `type` 只接受 `EXPENSE`、`INCOME`、`TRANSFER`。shared 新增 `MANUAL_TRANSACTION_TYPES` 給這兩個 DTO 用；`TRANSACTION_TYPES` 擴充為 7 種，給回應與列表篩選用。
- `PATCH` / `DELETE` 一筆借還交易 → `409 DEBT_TRANSACTION_READ_ONLY`，請改用債務端點。
- 交易回應新增 `debtId: string | null`：呼叫者是該債務擁有者時才有值（§3.5 最後一列）。
- `DELETE /ledgers/{id}`：帳本內有任何借還交易（含已軟刪除的）→ `409 LEDGER_HAS_DEBT_TRANSACTIONS`（決策 21）。

### 5.4 每人淨額

`GET /debts/summary` 回傳：

```ts
{
  items: Array<{
    counterpartyName: string;
    counterpartyUserId: string | null; // 連動中才有值
    net: number; // 正數 = 對方欠我；負數 = 我欠對方
  }>;
}
```

- 只計 `OPEN` 的債務。
- 分組鍵：連動中的債務依 `counterpartyUserId`；單邊債務依 `counterpartyName`（完全相同的字串才算同一人）。
- 單邊記錄與連動記錄即使名字相同，也是不同的兩列——系統無從得知單邊記錄上的「小明」是不是那位使用者。

### 5.5 單筆債務的回應

```ts
{
  id, direction, counterpartyName, principal, date, note,
  outstanding: number,                       // 算出來的
  status: 'OPEN' | 'SETTLED' | 'FORGIVEN',
  transactionId: string | null,
  payments: Array<{ id, amount, date, note, transactionId }>,
  link: null | {
    id, status: 'PENDING' | 'ACCEPTED',
    counterpart: {                           // 只在 ACCEPTED 時有值
      userId, name,
      outstanding: number,                   // 對方那份的未清餘額
      status: 'OPEN' | 'SETTLED' | 'FORGIVEN',
    } | null,
  },
  createdAt, updatedAt,
}
```

`link.counterpart.outstanding` 與自己的 `outstanding` 不同時，就是兩邊不一致（§2.3）。這是對方那份唯一會回給我的內容。

### 5.6 新增錯誤碼

`DEBT_OVERPAYMENT`、`DEBT_NOT_OPEN`、`DEBT_NOT_FORGIVABLE`、`DEBT_ALREADY_LINKED`、`DEBT_LINK_LIMIT_REACHED`、`DEBT_LINK_NOT_PENDING`、`DEBT_PROPOSAL_NOT_PENDING`、`NOT_FRIENDS`、`DEBT_TRANSACTION_READ_ONLY`、`LEDGER_HAS_DEBT_TRANSACTIONS`。

---

## 6. 可驗證的成功條件

### 3b-1

- **SC-D1**：建立借出 5000、記進連動帳本的現金帳戶 → 現金餘額少 5000；該帳本交易列表出現一筆 `LEND`，`categoryId` 為 `null`。
- **SC-D2**：4 種型別對餘額的方向符合 §4.1 的表；`accounts.service.ts` 的型別處理是窮舉的（新增一個型別卻沒處理，typecheck 失敗）。
- **SC-D3**：記兩次還款 2000、3000 → 未清餘額 3000、0，狀態 `OPEN`、`SETTLED`；第三次記 1 元 → `409 DEBT_NOT_OPEN`；還款超過未清餘額 → `409 DEBT_OVERPAYMENT`。
- **SC-D4**：借出的債務，還款交易型別為 `COLLECT`；借入的為 `REPAY`。請求 body 裡沒有型別欄位可以指定。
- **SC-D5**：不帶 `record` 建立的舊債沒有交易，餘額不變，未清餘額照算。
- **SC-D6**：免除 → 狀態 `FORGIVEN`、不產生交易、餘額不變；對 `BORROWED` 的債務免除 → `409 DEBT_NOT_FORGIVABLE`；免除後記還款 → `409 DEBT_NOT_OPEN`。
- **SC-D7**：刪除債務 → 債務與所有交易都被軟刪除，餘額回到建立前。
- **SC-D8**：`/transactions` 端點無法建立借還型別（`400`）、無法把既有交易改成借還型別（`400`）、`PATCH` / `DELETE` 借還交易 → `409 DEBT_TRANSACTION_READ_ONLY`。
- **SC-D9**：帳本內有借還交易 → 真刪回 `409 LEDGER_HAS_DEBT_TRANSACTIONS`；封存照常。
- **SC-D10**：`record` 指到自己不是成員的帳本 → `404`；是成員但只有 VIEWER → `403`（兩者與既有交易端點一致）；指到別人的帳戶 → `404`；指到封存帳本 → `409 LEDGER_ARCHIVED`。
- **SC-D11**：每人淨額：A 借給「小明」1000、向「小明」借 300、借給「小華」500 → 兩列：小明 +700、小華 +500；已結清與已免除的債務不計入。
- **SC-D12**：共享帳本的其他成員看得到借還交易，但交易回應的 `debtId` 是 `null`，且 `GET /debts/{該債務}` → `404`。

### 3b-2

- **SC-D13**：A 對好友 B 送連動請求 → B 接受並選自己的帳本與帳戶 → B 那份方向相反、本金相同，B 的帳戶餘額相應變動；雙方的 `link.counterpart` 顯示對方。
- **SC-D14**：對非好友送請求 → `409 NOT_FRIENDS`；已有 `PENDING` 或 `ACCEPTED` → `409 DEBT_ALREADY_LINKED`；第 4 次送 → `409 DEBT_LINK_LIMIT_REACHED`。
- **SC-D15**：B 拒絕 → A 那份不變，`link` 為 `null`；B 看不到 A 的債務（`404`）。
- **SC-D16**：連動後 A（債權人）記還款 1000 → A 那份未清餘額立刻減少；B 收到 `PAYMENT` 提議；B 接受並選帳戶 → B 那份未清餘額減少、B 帳戶產生 `REPAY`；B 拒絕 → B 那份不變，雙方的 `counterpart.outstanding` 顯示差異。
- **SC-D17**：`AMEND` 與 `FORGIVE` 提議的接受與拒絕，結果符合 §3.4 的表。
- **SC-D18**：任一方解除連動、刪除自己那份、或解除好友 → 連動轉為 `UNLINKED`，未回應的提議變成 `CANCELLED`，兩份各自保留；之後的變更不再產生提議。
- **SC-D19**：授權矩陣——連動請求與提議的每一種動作（接受、拒絕、取消）× 每一種角色（發起者、收件者、第三人）都有測試，結果符合 §3.5。
- **SC-D20**（SEC-19 延伸）：A 與 B 連動後，A 讀取 B 那份債務、B 的帳本、B 的交易、B 的帳戶 → 一律 `404` 或不出現在清單中；連動請求與提議的回應不含對方的備註、帳本、帳戶。
- **SC-D21**：送出與接受連動請求：同一 IP 每分鐘第 11 次 → `429`。

### 共通

- **SC-D22**：`pnpm lint / typecheck / test / build / format:check` 與兩套 e2e 全綠；migration 進版控且重跑無 pending。

---

## 7. 對 Web 的影響（最小相容改動）

`TRANSACTION_TYPES` 擴充後，Web 有兩處用 `Record<型別, …>` 窮舉，typecheck 會直接失敗。本步只做讓既有畫面**不壞、不誤導**的改動：

- `TransactionList.tsx`：4 種新型別的正負號（`LEND`、`REPAY` 為 `-`；`BORROW`、`COLLECT` 為 `+`）、顏色（沿用轉帳的中性色）、中文標籤（借出、借入、收回、償還）。
- 借還交易不顯示「編輯」「刪除」按鈕（後端也會擋，這裡只是體驗）。
- `TransactionFilters.tsx` 的型別下拉**不加**新型別；那是借還帳畫面那一步的事。

⚠️ Web 還在持續微調視覺，這兩個檔案可能衝突。改動會盡量小，合併前先把 `main` 併進來。

---

## 8. 測試策略

- **授權先行（SEC-10）**：SC-D19 的矩陣、SC-D12 與 SC-D20 的隔離測試在實作前寫好、先看到紅燈，當作 worker 的驗收門檻，worker 不准修改。
- **單元測試**：未清餘額與狀態的計算（含軟刪除的還款不計入）、方向 → 交易型別的對應、每人淨額的分組、每一種提議被接受後對收件者那份的影響。
- **e2e**：`debts.e2e-spec.ts`（3b-1 流程與餘額）、`debt-links.e2e-spec.ts`（3b-2 流程）、`debts-isolation.e2e-spec.ts`（授權與隔離）、`debts-throttle.e2e-spec.ts`（限流）。
- **餘額回歸**：既有的帳戶 e2e 全部維持綠燈，證明 §4.1 的改寫沒有改變舊型別的結果。

---

## 9. 延後項目

| 項目                 | 說明                                                          | 時機                            |
| -------------------- | ------------------------------------------------------------- | ------------------------------- |
| **代墊**             | 一筆消費拆給多人。初步想法見《專案決策脈絡.md》「階段三定案」 | 開發者要求另開一輪設計          |
| 借還帳的 Web 畫面    | 債務列表、每人淨額；連動請求與提議的收件匣                    | 3b-1 之後；連動部分在 3b-2 之後 |
| 單邊記錄升級成連動   | 對方日後註冊時，把「小明」接到那位使用者                      | 待定                            |
| 刪除還款的同步       | 目前刪除還款不送提議，差異顯示在 `counterpart`                | 有實際需求時                    |
| 統計報表如何呈現借還 | 決策 22 定了「不算收入也不算支出」；報表本身還不存在          | 做統計報表時                    |
| 呆帳是否計入損失     | 免除不產生交易，統計看不到這筆損失（2026-09-23 已接受的代價） | 做統計報表時                    |

---

## 10. 界線（Always / Ask first / Never）

- **Always**：借還型別的資金方向只由型別決定；未清餘額一律算出；所有寫入對方記錄的動作都要經過對方確認；授權測試先於實作。
- **Ask first**：本 spec 的 schema 變更核可即視為同意，但**手寫 SQL 要在套用前給開發者看過**；任何放寬 §3.5 的改動。
- **Never**：讓 `/transactions` 端點產生或修改借還交易；把對方的備註、帳本、帳戶回傳給另一方；未經對方確認就寫入對方的債務或交易；在前端計算未清餘額或淨額。

---

## 11. Step 拆分概觀（核可後寫入 `tasks/`）

### 執行順序的調整（2026-09-24）

原本是 3b-1 → 3b-2 → Web 畫面。開發者同意改成 3b-1 → **3b-1 的 Web 畫面** → 3b-2。理由：

- 3b-2 的 3 種提議（記還款、改金額、免除）全部沿用 3b-1 的規則。3b-1 的規則現在改，只動一處；3b-2 做完才改，要同時改自己那份、提議格式、接受提議時的套用邏輯三處。
- 只看 Swagger 很難感受操作流程。先有畫面，才能照「不完備處等實際成果出來再調整」找出 3b-1 規則的問題。
- 3b-1 的畫面（列表、新增、詳情、還款）在 3b-2 會原樣沿用，只加連動按鈕與待確認提議區塊。

好友（3a）的畫面不在這一輪，留到 3b-2 的畫面一起做，因為連動要先有好友。

**3b-1 單邊借還**（一個 PR）

1. shared 契約：型別、`MANUAL_TRANSACTION_TYPES`、錯誤碼。
2. schema + migration：新 enum 值、`Debt`、`DebtPayment`，手寫 CHECK。
3. 餘額計算改寫成窮舉，既有測試維持綠燈。
4. 授權與隔離測試先行（SC-D10、SC-D12）。
5. 債務 CRUD、還款、免除、每人淨額。
6. 交易端點與帳本刪除的調整（§5.3）。
7. Web 最小相容改動（§7）。

**3b-2 連動**（一個 PR）

1. schema + migration：`DebtLink`、`DebtProposal`，手寫部分唯一索引與 CHECK。
2. 授權矩陣先行（SC-D19、SC-D20）。
3. 連動請求。
4. 提議（`PAYMENT`、`AMEND`、`FORGIVE`）。
5. 解除連動，與 3a 的解除好友接起來（`FriendsService.remove`）。
6. 限流與最終驗收。
