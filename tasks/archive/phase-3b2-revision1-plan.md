# 實作計畫：3b-2 修訂 1（對象頁、暱稱、邀請不綁人、文字極簡）

> 依據：`docs/specs/phase-3b2-linking.md` §12（決策 73～81、SC-K19～K27）、`docs/specs/phase-3b2-web.md` §10（W44～W51、SC-W51～W60）。
> **一個分支、一個 PR**（`feature/phase-3b2-revision1`）：shared 型別有破壞性改動（`name` 可為 null、拿掉 `forLink`、接受不帶 body），後端改完 Web 會編譯失敗，所以後端與畫面一起合併。

---

## 1. 元件與相依

```
A 後端
  A1 shared 契約（協調者）→ A3 隔離測試先行（協調者）
  → A2 schema + migration → A4 邀請與接受 → A5 名字、合併、待詢問 → A6 e2e（一個 Codex worker，gpt-6-sol xhigh，依序做）
B 畫面（A1 完成即可開始，與 A2～A6 平行）
  B1 hooks、錯誤訊息、讓 Web 先編譯通過（協調者）
  ├─ 第 1 波（平行）
  │   B2 對象頁、側欄、路由、新的邀請視窗（worker）
  │   B3 往來帳管理按鈕、暱稱／合併／詢問視窗、文案精簡（worker）
  ├─ 第 2 波（等 B3 的詢問視窗）
  │   B4 待確認卡片與邀請頁改成不選人＋詢問（worker）
  └─ B5 web e2e 與整體驗收（協調者）
```

## 2. 實作重點

### 2.1 名字的兩層（決策 77）

- `Counterparty.name` 改成 `String?`。service 保證「未連動一定有 `name`」：建立、改名、解除連動三個入口把關。
- `displayName` 在 service 的對應函式算：`name ?? link.userName`。列表與單筆原本就 join 了連動的使用者（`theirBalance` 要用），不多一次查詢。
- 交易列表的 `debt.counterparty.name`：include 多 join 連動的使用者名字，同一條規則。
- `?q=`：`OR: [{ name contains }, { 連動的使用者 name contains }]`。連動的使用者在 `CounterpartyLink` 的另一側，用兩個 relation（`linkAsLow`、`linkAsHigh`）各寫一條條件。

### 2.2 邀請與接受（決策 73、74、75）

- `FriendRequestsService.create`（3a 的 `POST /friend-requests`）加上決策 57、61 的檢查（原本在 `createLinkInvite`），移除 `createLinkInvite`。邀請連結同理。
- `establishLink` 改成替雙方各建一個 `name = null` 的對象，`askMerge` 依「當下有沒有未連動的對象」決定。建立與連動在同一個資料庫交易。
- 接受的回應型別新增 `LinkAccepted { counterpartyId, askMerge, otherUser }`，兩個接受端點共用。

### 2.3 合併（決策 76、80）

一個資料庫交易：

1. 依 id 排序鎖兩個對象（沿用決策 50 的鎖法，避免同時記帳時的競態）。
2. 檢查：都屬於自己、`target` 已連動、`source` 未連動、不同一筆。不符回 `409 MERGE_NOT_ALLOWED`；不是自己的回 `404`。
3. `debtEntry.updateMany({ counterpartyId: source → target })`。被併的紀錄沒有配對，提議也已在解除連動時取消，不必處理。
4. 刪除 `source`；`target.name` 為 null 時改成 `source.name`（先刪再改，避開 `(ownerId, name)` 唯一值）。
5. `target.askMerge = false`。

### 2.4 解除連動的名字（決策 78）

`unlink` 在同一個交易裡，對雙方各自：`name` 為 null 時設成當下的帳號名稱；撞名就試「名字 2」「名字 3」…（上限 99，超過回 409，實務上不會發生）。`DELETE /friends/{userId}` 走同一段。

### 2.5 migration

`prisma migrate diff` 產生 SQL（agent 環境不能跑 `migrate dev`）。手寫：先取消 `PENDING` 的邀請、撤銷未使用的連結，再刪兩個 `counterpartyId` 欄位；放寬 `Counterparty_name_trimmed` CHECK。PR 描述列出 SQL。

### 2.6 Web

- `use-linking.ts`：拿掉 `forLink` 篩選；接受改成不帶 body，回 `LinkAccepted`；新增 `useMergeCounterparty`、`useDismissMergePrompt`、`useMergePrompts`（`?askMerge=true`）、`useOutgoingInvites`（對象頁「邀請中」）。`useOutgoingLinkInvite(counterpartyId)` 移除。
- `use-debts.ts`：`useSendLinkInvite`、`useCreateLinkInviteUrl` 改打 `/friend-requests`、`/friend-invite-links`，不帶對象；`useRenameCounterparty` 接受 `name: string | null`。
- 導覽：`useOpenCounterpartyLedger` 的目的地改成 `/counterparties`（對象頁），對象頁讀同一個 `location.state`。
- 詢問視窗 `MergePromptDialog` 由 B3 做，B4 的待確認卡片與邀請頁共用。

## 3. 風險與對策

| #   | 風險                                                                      | 對策                                                                                          |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1  | `name` 變 null 後，某處仍拿 `name` 顯示，畫面出現空白                     | shared 型別改成 `string \| null`，TypeScript 會標出所有用到的地方；顯示一律改用 `displayName` |
| R2  | 合併與同時記帳的競態                                                      | 兩個對象依 id 排序加鎖；單元測試＋一條並行的 e2e                                              |
| R3  | 未來加「刪除帳號」時，連動被 cascade 刪掉，`name = null` 的對象變成沒名字 | 目前沒有刪除帳號的端點；在 `counterparty-links.ts` 檔頭與 spec 寫明「刪除帳號要先走決策 78」  |
| R4  | 拿掉 3a 的一般好友邀請，影響 3a 的 e2e                                    | 3a 的 e2e 改成驗連動邀請的同一條路徑；`/friends` 列表保留                                     |
| R5  | worker 在同一個 worktree 改到同一個檔案                                   | Ownership 分檔；`LinkInviteDialog` 的刪除歸 B3（它的 import 在 `CounterpartyDetail`）         |

## 4. 驗證點

- **A**：後端單元測試、`debt-linking` 與隔離 e2e（新增 SC-K19～K26）、3a 的 friends e2e 改寫後全綠。
- **B1**：`pnpm typecheck` 全綠（Web 先能編譯）、hooks 測試。
- **B2～B4**：元件測試；協調者看完整 diff、重跑檢查。
- **B5**：SC-W51～W59 的 e2e；完整 CI 綠。
- **合併後**：提醒開發者 `prisma migrate deploy`、`pnpm build`、重開 API 與 Vite。

## 5. 實作紀錄

2026-09-26。後端 worker：Codex `gpt-6-sol` xhigh（A2、A4～A6，一個 worker 依序做）；畫面 worker：Codex `gpt-6-luna` max（B2、B3 平行，B4 接在 B3 後）。A1、A3、B1、B5 由協調者做。

1. **合併時取消被併紀錄的舊提議**（後端 worker 的決定，驗收同意）：被併的對象可能以前連動過，它的紀錄帶著舊的 `PENDING`／`DECLINED` 提議。若不處理，搬進新連動後會錯誤顯示「對方未接受」。合併時把這些提議改成 `CANCELLED`、清掉配對，搬過去的紀錄一律 `sync = NONE`。
2. **解除連動補名字時先去空白**（驗收時發現）：帳號名稱註冊時只限長度、不去空白；照抄會違反 `Counterparty_name_trimmed` CHECK，整個解除連動失敗。改成先去空白，空字串用「對方」，並加單元測試。
3. **免除與刪除對象的確認句**（驗收時補回）：B3 依 W44 把兩個確認視窗的說明清空；免除會把欠款歸零、和錢有關，屬於 W44 的例外，補回一句「{名字}欠你的 $X 將歸零」；刪除對象補「刪除「{名字}」？」讓使用者知道刪的是誰。往來帳標題旁的「連動」標籤也補回（樣稿畫面 5 有）。
4. **`LinkInviteDialog` 移除**：邀請改由 `features/counterparties/InviteDialog` 發；往來帳不再有邀請入口。
5. **e2e**：`debt-linking.spec.ts` 改寫成新流程 4 條（主線、邀請連結、錯過詢問後補做、帳上對不起來）；`e2e/api.ts` 的 `linkByEmail` 改成新流程，另加 `mergeCounterparties`。
6. **派工的坑**：Codex 仍會出現「只貼上沒送出」，兩次補送 Enter（`docs/orca-multi-agent.md` §4 已記）。

驗證：api 單元 319、api e2e 141（隔離 15）、web 單元 533、web e2e 44，lint／typecheck／format:check／build 全綠。
