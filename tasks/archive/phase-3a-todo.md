# 任務清單：階段三 (3a) — 好友系統

> 依據：`docs/specs/phase-3a-friends.md`、`tasks/phase-3a-plan.md`。
> 依相依順序排列。「負責」欄的 worker 一律是 Claude Code + `claude-opus-5`。

| #   | 任務                   | 負責   | 相依   |
| --- | ---------------------- | ------ | ------ |
| T1  | shared 契約            | 協調者 | —      |
| T2  | schema + migration     | 協調者 | T1     |
| T3  | 授權測試先行           | 協調者 | T2     |
| T4  | 好友邀請               | worker | T3     |
| T5  | 邀請連結               | worker | T3     |
| T6  | 好友清單與解除好友     | worker | T3     |
| T7  | 流量限制測試與 OpenAPI | worker | T4～T6 |
| T8  | 最終驗收               | 協調者 | T7     |

T4～T6 彼此獨立，平行派出。依 plan §5，worker 不准修改 T3 的授權測試、Prisma schema 與 shared 契約。

---

## T1｜shared 契約

- 新增 `packages/shared/src/types/friend.ts`：`Friend`、`FriendRequest`（含 `direction`、`status`、對方資訊）、`CreateFriendRequestRequest`、`FriendInviteLinkCreated`、`FriendInviteLinkPreview`、`FriendInviteTokenRequest`、`FriendRequestStatus`。
- `error-codes.ts` 新增 `CANNOT_FRIEND_SELF`、`ALREADY_FRIENDS`、`FRIEND_REQUEST_PENDING`、`FRIEND_REQUEST_NOT_PENDING`、`INVITE_LINK_INVALID`。

**驗收**：`pnpm typecheck` 通過；型別欄位與 spec §5 的回應欄位一一對應（`Friend` 只有 `userId`、`name`、`since`）。

## T2｜schema + migration

- `schema.prisma` 加入 spec §4 的 3 個 model 與 enum。
- `prisma migrate dev --create-only` 產生 DDL，附上手寫的 CHECK 約束與部分唯一索引。
- **套用前把 migration SQL 給開發者看**（spec §9）。

**驗收**：`prisma migrate status` 無 pending；在 `psql` 手動插入 `userLowId > userHighId` 的一筆會被 CHECK 擋下；同一對使用者插入第二筆 `PENDING` 邀請會被唯一索引擋下。

## T3｜授權測試先行（SEC-10）

- `friend-requests.service.spec.ts`：SC-F6 的授權矩陣，用 `it.each` 列出「動作 × 角色 → 預期結果」。
- `test/friends-isolation.e2e-spec.ts`：SC-F10 的 5 條隔離檢查。

**驗收**：測試存在，而且在 T4～T6 完成前是紅燈。

## T4｜好友邀請

- `friend-requests.service.ts` 的送出、列出、接受、拒絕、取消；決策 8（反向邀請直接成立）。
- `friend-requests.controller.ts` 與 DTO；`POST /friend-requests` 加 `@Throttle`（每分鐘 10 次）。

**驗收**：T3 的授權矩陣全綠（worker 驗）；SC-F1～F5 的 e2e 通過（協調者合併後驗）。

## T5｜邀請連結

- `friend-invite-links.service.ts`：32 bytes 隨機 token、SHA-256 雜湊、產生時撤銷舊連結、條件式消耗。
- `friend-invite-links.controller.ts` 與 DTO（token 在 body）；產生與接受加 `@Throttle`。

**驗收**：SC-F7、SC-F8 通過；兩個請求同時接受同一條連結，只有一個成功（單元測試模擬 `count = 0`）。

## T6｜好友清單與解除好友

- `friends.service.ts` 與 `friends.controller.ts`：`GET /friends`（分頁，新到舊）、`DELETE /friends/{userId}`。

**驗收**：SC-F9、SC-F11 通過；T3 的隔離測試全綠。

## T7｜流量限制測試與 OpenAPI

- `test/friends-throttle.e2e-spec.ts`：同 IP 第 11 次送出邀請回 `429`（做法見 plan §2.6）。
- 三個 controller 補齊 `@ApiTags` 與各狀態碼的 `@Api*Response`。

**驗收**：SC-F12 通過；`/docs` 上三組端點的回應碼與 spec §5 一致。

## T8｜最終驗收

- 對照 SC-F1～SC-F13 逐條打勾，結果寫進 plan 的實作紀錄。
- `lint / typecheck / test / build / format:check` 與兩套 e2e 全綠。
- 更新 spec 狀態、`docs/README.md`；開 PR。

**驗收**：CI 全綠，PR 描述連回 spec 各節。
