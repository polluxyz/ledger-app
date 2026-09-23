# 實作計畫：階段三 (3a) — 好友系統

> 狀態：**待開發者核可**（2026-09-23）
> 依據：`docs/specs/phase-3a-friends.md`（2026-09-23 核可）。
> 對應成功條件：SC-F1～SC-F13。
> 分支：`feature/friends`（自 `main` 開）。**本步不動前端。**

---

## 1. 元件與相依

```
packages/shared/src/
├── types/friend.ts              新增：Friend、FriendRequest、FriendInviteLink 等請求／回應型別
├── constants/error-codes.ts     修改：5 個新錯誤碼
└── index.ts                     修改：匯出

apps/api/prisma/
├── schema.prisma                修改：3 個 model、1 個 enum、User 的 6 個反向關聯
└── migrations/<新>/             新增：Prisma 產生的 DDL + 手寫的 CHECK 與部分唯一索引

apps/api/src/common/
└── clock.ts                     新增：可注入的時鐘（CLOCK token），測試可指定現在時間

apps/api/src/friends/
├── friends.module.ts
├── friend-requests.controller.ts    POST/GET /friend-requests、accept/decline/cancel
├── friend-invite-links.controller.ts POST /friend-invite-links、preview、accept
├── friends.controller.ts            GET /friends、DELETE /friends/{userId}
├── friends.service.ts               好友關係與邀請的狀態轉換
├── friend-invite-links.service.ts   token 產生、雜湊、條件式消耗
├── friendship-key.ts                把一對 userId 排成 (low, high)
├── dto/*.dto.ts
└── *.spec.ts                        單元測試，與被測檔同目錄

apps/api/test/
├── friends.e2e-spec.ts          SC-F1～F5、F7、F9、F11
├── friends-isolation.e2e-spec.ts SC-F10（SEC-19）
└── friends-throttle.e2e-spec.ts SC-F12

apps/api/src/app.module.ts       修改：匯入 FriendsModule
```

相依順序：shared → schema → 授權測試 → service → controller → e2e。三個 controller 之間沒有相依，可以平行。

---

## 2. 實作重點

### 2.1 時鐘

目前程式直接呼叫 `new Date()`。3a 有兩個時間規則（連結 10 分鐘過期、邀請的回應時間），測試需要指定「現在」。
新增 `common/clock.ts`：一個 `CLOCK` injection token，正式環境提供 `() => new Date()`，測試換成固定值。
只在 friends 模組使用，不回頭改既有模組。

### 2.2 好友關係的排序

`friendship-key.ts` 的一個純函式把兩個 userId 排成 `{ userLowId, userHighId }`。所有讀寫 `Friendship` 的地方都經過它。
資料庫的 CHECK 約束（`userLowId < userHighId`）確保漏經過時直接報錯，不會默默存成反向的第二筆。

注意：JavaScript 的字串比較與 PostgreSQL 的 `<` 在不同 collation 下結果可能不同。UUID 只含 `0-9a-f-`，兩邊都依 ASCII 比較，結果一致。
這一點寫進 `friendship-key.ts` 的註解，並用一組固定 UUID 的單元測試鎖住。

### 2.3 決策 8（對方已邀請我）

`POST /friend-requests` 在同一個資料庫交易（transaction）內：先找對方送給我的 `PENDING` 邀請，有就把它改成 `ACCEPTED` 並建立 `Friendship`，回傳那一筆。沒有才建立新邀請。

### 2.4 連結的條件式消耗

接受連結用 `updateMany({ where: { tokenHash, usedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { usedAt, usedById } })`，看 `count` 是否為 1。
為 0 就回 `INVITE_LINK_INVALID`。兩人同時接受時只有一人拿到 1。

「已經是好友」（決策：連結不被消耗）要在消耗**之前**檢查。兩個動作放在同一個資料庫交易內。

### 2.5 授權

好友相關的授權全部在 service 層判斷：先查邀請，呼叫者既不是發起者也不是收件者就回 `404`，是當事人但動作不對就回 `403`。
**不新增 guard，也不動 `LedgerAccessGuard`**（spec 決策 15）。

### 2.6 流量限制的測試

現有程式沒有流量限制的 e2e 測試（`app.module.ts` 的註解說「另以獨立測試驗證」，但實際上不存在）。
`friends-throttle.e2e-spec.ts` 在建立 app 前把 `process.env.NODE_ENV` 暫時改成非 `test`，讓 `skipIf` 不成立，測完還原。
這個檔案自己一個 suite，不影響其他 e2e。

---

## 3. 風險與對策

| 風險                                                  | 對策                                                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 授權寫錯但測試是綠的                                  | SEC-10：SC-F6 的授權矩陣與 SC-F10 的隔離測試**先寫、先看到紅燈**，再寫實作          |
| 手寫 SQL 與 Prisma 產生的 DDL 衝突                    | 先 `prisma migrate dev --create-only` 產生 DDL，再把手寫 SQL 附在後面，套用前給你看 |
| 部分唯一索引讓 `prisma migrate dev` 以為 schema 漂移  | Prisma 不追蹤部分索引，實測確認；若會漂移就改用 `migrate deploy`，並記入實作紀錄    |
| `web-redesign` worktree 同時跑 e2e                    | 跑 e2e 前檢查 3100 / 5273 埠與測試程序，有人在跑就等                                |
| migration 套到 `ledger_test` 後，對方分支沒有這個檔案 | 與 PR #51 相同的狀況。合併後提醒對方把 `main` 併進去                                |

---

## 4. 驗證點

1. Step 2 結束：migration SQL 給開發者看過，套用後 `prisma migrate status` 無 pending。
2. Step 3 結束：授權測試存在且為紅燈（證明它真的在測東西）。
3. Step 6 結束：授權測試全綠。
4. Step 7 結束：對照 SC-F1～SC-F13 逐條打勾；`lint / typecheck / test / build / format:check` 與兩套 e2e 全綠。

---

## 5. 分工

見 `phase-3a-todo.md` 各任務的「負責」欄。依 `CLAUDE.md` §11，授權、資料隔離、Prisma schema、API 介面由協調者自己做。
worker 一律用 Claude Code，模型釘 `claude-opus-5`（開發者 2026-09-23 指定）。

---

## 6. 實作紀錄

（實作中遇到的計畫外問題與處置記在這裡。）
