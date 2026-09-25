# 實作計畫：3b-2 連動的畫面（含 F25、F26 後端補充）

> 依據：`docs/specs/phase-3b2-web.md`（W22～W43、SC-W35～W50）、`docs/specs/phase-3b2-linking.md`（決策 51～72）。
> 開發者 2026-09-25 核可 spec（「ok 開始」）。
> **兩個 PR**：
>
> 1. `feature/phase-3b2-api-additions`：F25、F26（協調者自己做，API 介面）。先合併。
> 2. `feature/phase-3b2-web`：畫面（派 Codex worker）。從合併 PR 1 之後的 `main` 開分支。
>
> 分兩個 PR 的理由：F25、F26 只加欄位、改動小，先合併能讓畫面的 worker 拿到最終的 shared 型別；也讓後端的審查與畫面的審查分開。

---

## 1. 元件與相依

```
A 後端補充（協調者，PR 1）
  A1 shared 型別 → A2 service 與 e2e → A3 更新 phase-3b2-linking.md
B 畫面（PR 2）
  B1 hooks、錯誤訊息、導覽到往來帳（協調者，定介面）
  ├─ 第 1 波（平行）
  │   B2 下拉選單、新增對象、借還表單提示、清單標籤（worker）
  │   B3 往來帳的連動區塊、邀請視窗、同步標籤、警告（worker）
  ├─ 第 2 波（平行，等 B2 的下拉選單）
  │   B4 總覽的待確認卡片（worker）
  │   B5 邀請頁 /invite（worker）
  └─ B6 web e2e 與整體驗收（協調者）
```

## 2. 實作重點

### 2.1 F25：送出的連動邀請帶 `counterpartyId`

- `packages/shared/src/types/friend.ts`：`FriendRequest` 加 `counterpartyId: string | null`，註解寫明「只有送出的連動邀請帶值」。同一檔把邀請連結路徑的註解從 `/friends/invite#<token>` 改成 `/invite#<token>`。
- `FriendRequestsService.toFriendRequest`：`incoming` 時一律 `null`；`outgoing` 時回 `row.counterpartyId`（`FriendRequestRow` 已有此欄位）。
- 隔離：收件者看不到發起者的對象 id（`phase-3b2-linking.md` §3.5）。e2e 驗 B 讀到的 `counterpartyId === null`。

### 2.2 F26：收到的 `AMEND` 帶 `previous`

- `packages/shared/src/types/debt.ts`：`DebtProposal` 加 `previous: { amount: number; date: string } | null`。
- `PROPOSAL_INCLUDE` 加 `targetEntry: { select: { delta: true, date: true, deletedAt: true } }`（schema 已有 `targetEntry` relation，`onDelete: SetNull`）。
- `toDebtProposal`：`incoming && type === 'AMEND' && targetEntry && deletedAt === null` 時回 `{ amount: Math.abs(delta), date }`，其餘 `null`。
- **不改 Prisma schema。**

### 2.3 畫面的共用介面（B1，協調者先做）

B1 先提交，worker 依這些介面實作，不自己改：

| 檔案                              | 內容                                                                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `features/debts/use-debts.ts`     | `useCounterparties({ q, limit })`、`useCreateCounterparty`、`useSendLinkInvite`、`useCreateLinkInviteUrl`、`useUnlinkCounterparty`、`useOutgoingLinkInvite(counterpartyId)`（從送出的待確認邀請中挑出這個對象的那筆）、`useCancelLinkInvite` |
| `features/linking/use-linking.ts` | `useIncomingLinkInvites`（`forLink` 篩選）、`useIncomingProposals`、`useAcceptLinkInvite`、`useDeclineLinkInvite`、`useAcceptProposal`、`useDeclineProposal`、`useInvitePreview`、`useAcceptInviteLink`                                      |
| `features/linking/navigation.ts`  | `openCounterpartyLedger(navigate, counterpartyId)`：導到 `/transactions?view=debts`，`location.state` 帶 `openCounterpartyId`                                                                                                                |
| `pages/TransactionsPage.tsx`      | 讀 `location.state.openCounterpartyId`，打開右側欄的往來帳一次後清掉 state                                                                                                                                                                   |
| `lib/error-messages.ts`           | spec §4.7 的訊息                                                                                                                                                                                                                             |

- 所有會改資料的 hook 成功後，沿用 `invalidateAfterWrite`，另外失效待確認的查詢（`['friend-requests']`、`['debt-proposals']`）與往來紀錄。
- `useOutgoingLinkInvite` 在前端「從清單挑出 `counterpartyId` 相符的那筆」是查找，不是規則推導，符合 W42。

### 2.4 下拉選單（B2）

- 自己寫，不引入套件。ARIA combobox：`input[role=combobox][aria-expanded][aria-controls][aria-activedescendant]` ＋ `ul[role=listbox] > li[role=option]`。
- props 大致為 `value`、`onChange(name)`、`onSelect(counterparty | { name })`、`excludeLinked?: boolean`、`label`。第 2 波的 B4、B5 用 `excludeLinked`。
- 300ms debounce 用 `setTimeout`，清單用 `useCounterparties({ q, limit: 50 })`。
- 選定後的餘額提示沿用現在 `CounterpartyPicker` 的文字，但 `excludeLinked` 模式下不顯示（接受邀請時不需要）。

### 2.5 待確認卡片（B4）

- 「一次只展開一筆」用卡片層的 `expandedId` state。
- 接受新增提議的帳本清單：沿用既有的帳本 hook，篩 EDITOR 以上、未封存。帳戶欄位的顯示條件與標籤，照 `DebtEntryForm` 的既有規則寫一份（B4 不改 `DebtEntryForm`）。
- W43 預覽：讀 `useCounterparty(proposal.counterpartyId)` 的 `balance`，加上這筆的 delta 方向（借入 −、借出 ＋、他還你 −、你還他 ＋）。只用於顯示。
- 409 的兩個錯誤碼切換成「改成拒絕」模式；`PROPOSAL_NOT_PENDING` 時重新取待確認。

### 2.6 邀請頁（B5）

- 路由放在 `ProtectedRoute` 之外（與 `/` 同層）。
- token 從 `location.hash` 讀，**不存進任何 storage**，只在記憶體裡。接受成功後 `history.replaceState(null, '', '/invite')` 再導覽。
- 沒登入時用 `AuthDialog`，登入後 `useAuth().isAuthenticated` 變真，頁面自動改成預覽狀態，hash 不受影響。

## 3. 風險與對策

| #   | 風險                                                      | 對策                                                                                                       |
| --- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| R1  | 自寫的下拉選單鍵盤與焦點行為出錯，e2e 選不到人            | 依 ARIA combobox 模式；元件測試用 `getByRole('combobox'/'option')`；`debts.spec.ts` 改成相同的選取方式     |
| R2  | 第 2 波依賴 B2 的 props；B2 改了介面會連帶影響            | props 在 plan §2.4 定好；B2 驗收時確認介面一致才開第 2 波                                                  |
| R3  | 邀請頁的 token 外洩（進 storage、日誌、網址路徑）         | §2.6 的規則寫進 Task spec 的 Constraints；驗收時搜尋 `localStorage`、`sessionStorage` 與 token 的使用處    |
| R4  | e2e 要兩個使用者同時操作                                  | 用兩個 browser context 各自登入 A、B（fixtures 已有兩個測試帳號）；B6 由協調者寫，必要時擴充 fixtures      |
| R5  | 平行 worker 在同一個 worktree 改到同一個檔案              | 每個任務的 Ownership 列出檔案；共用檔（hooks、錯誤訊息、TransactionsPage）只由 B1 改；格式化只跑自己的檔案 |
| R6  | 畫面出現「好友」（例如沿用後端英文訊息或舊文案）          | §4.7 的錯誤訊息全部在 B1 覆寫；B6 的 e2e 檢查頁面文字；驗收時 `grep 好友 apps/web/src`                     |
| R7  | 開發者的 dev DB 沒套 `20260925120000_link_counterparties` | PR 2 合併後提醒：`prisma migrate deploy`、`pnpm build`、重開 API 與 Vite                                   |

## 4. 驗證點

- **PR 1**：`pnpm lint / typecheck / test / format:check`；後端兩套 e2e（`debt-linking`、隔離）含 F25、F26 的新斷言；CI 全綠。
- **B1**：hooks 測試驗證路徑、query、body 與快取失效；`TransactionsPage` 從 state 打開往來帳的元件測試。
- **B2～B5**：各自的元件測試（對應 SC 見 todo）；協調者看完整 `git diff`，重跑 `pnpm typecheck`、`pnpm test`。
- **B6**：SC-W35～W48 的 e2e 主線；`grep -rn "好友" apps/web/src` 只剩註解；CI 全綠。
- **合併後**：用開發者的 dev 環境手動走一次 SC-W38～W40（兩個帳號）。

## 5. 派工

- worker 順序：Codex（`gpt-6-luna`，`model_reasoning_effort=max`，`--dangerously-bypass-approvals-and-sandbox`）→ Pi GLM → Antigravity Gemini（`CLAUDE.md` §11）。
- 全部 worker 在同一個 worktree（本 worktree），靠 Ownership 分檔。
- Task spec 開頭要求先讀根目錄與 `apps/web/CLAUDE.md`，以及 `docs/specs/phase-3b2-web.md` 的對應章節。
- 每個 Task spec 的 Constraints 必含 `docs/orca-multi-agent.md` §5 的四條，外加：不准改 `use-debts.ts`、`use-linking.ts`、`error-messages.ts`、`TransactionsPage.tsx`（B1 的檔案），需要改就回報；只對自己的檔案跑 `pnpm exec prettier --write`。

## 6. 實作紀錄

2026-09-25，PR 1 #76（F25、F26）、PR 2（畫面）。worker：B2～B5 全部 Codex（`gpt-6-luna` max）。

1. **hooks 位置**：`useOutgoingLinkInvite`、`useCancelLinkInvite` 放在 `features/linking/use-linking.ts`，不是 plan §2.3 寫的 `use-debts.ts`：它們打的是 `/friend-requests`，和其他連動邀請 hooks 放一起。`use-debts.ts` 另外留了兩個前綴常數只為了失效（避免兩檔互相 import）。
2. **錯誤訊息覆寫**：`toUserMessage` 與 `FormError` 多一個選填的 `messages` 參數，讓邀請連動視窗把 `USER_NOT_FOUND` 換成連動的語境（spec §4.7）。
3. **打開往來帳的導覽**：交易頁讀 `location.state.openCounterpartyId`，面板內容在 render 期間切換（lint 規則 `react-hooks/set-state-in-effect` 不允許在 effect 裡 setState），effect 只負責打開右側欄與用 replace 導覽清掉 state（帶 `keepRightPanel`）。
4. **下拉選單的 debounce**（驗收時修）：查詢結果還沒追上輸入時，不顯示「＋ 新增」與「新對象，送出時建立」，否則打既有的名字會閃一下。
5. **「到總覽接受」**（驗收時修）：B3 原本用 `<a href>`，會整頁重載，改成 router 的 `Link`。
6. **格式不對的 token**（e2e 發現）：後端對格式不對的 token 回 400 `VALIDATION_FAILED`，邀請頁原本把驗證訊息（含正規表示式）秀給使用者。改成和 `INVITE_LINK_INVALID` 一樣顯示「連結無效或已過期」，spec §4.6 同步補上。
7. **派工時踩到的坑**：Codex 有新版時會停在更新提示（`agent-update-prompt`），`worker-start` 失敗；選「Skip until next version」後關掉終端機重開即可（與 `docs/orca-multi-agent.md` §4 的記錄一致）。重派後兩個終端機都停在「只貼上沒送出」，補送 Enter。
8. **待確認卡片不會自己刷新**：停在總覽時，對方新送的提議要等切回分頁（React Query 的 refetchOnWindowFocus）或重新整理才出現。spec 沒有要求即時更新，e2e 用重新整理；操作後若覺得需要，再討論輪詢或推播。
