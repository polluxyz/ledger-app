/**
 * 好友系統（階段三 3a）的 request／response 型別。規格見 `docs/specs/phase-3a-friends.md`。
 *
 * 貫穿全檔的一條規則：**好友的 email 不出現在任何回應裡**（spec 決策 10）。經由邀請連結
 * 加入的好友，你從來沒拿到過對方的 email，清單不該把它交出去。唯一的例外是「我送出、
 * 尚未被接受的邀請」——那個 email 是我自己輸入的（決策 11）。
 */

/**
 * 好友邀請的狀態。與 Prisma 的 `FriendRequestStatus` enum 對應。
 *
 * 只有 `PENDING` 能轉換；其餘三個是終點（spec §3.1）。
 */
export const FRIEND_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

/** 從呼叫者的角度看，這筆邀請是別人送來的，還是我送出的。 */
export const FRIEND_REQUEST_DIRECTIONS = ['incoming', 'outgoing'] as const;
export type FriendRequestDirection = (typeof FRIEND_REQUEST_DIRECTIONS)[number];

/** 好友清單的一列。刻意不含 email。 */
export interface Friend {
  userId: string;
  name: string;
  /** 成為好友的時間，ISO 8601。 */
  since: string;
}

/**
 * 一筆好友邀請，從呼叫者的角度呈現。
 *
 * 對方資訊依方向與狀態而不同（spec 決策 10、11）：
 * - `incoming`：`counterpart` 帶發起者的 `userId` 與 `name`，`email` 為 `null`。
 * - `outgoing` 且尚未 `ACCEPTED`：只有 `email`（我自己輸入的那個），`userId` 與 `name`
 *   為 `null`。否則「知道一個 email」就能換到「這個人的名字」。
 * - `outgoing` 且已 `ACCEPTED`：對方已是好友，帶 `userId` 與 `name`，`email` 為 `null`。
 */
export interface FriendRequest {
  id: string;
  direction: FriendRequestDirection;
  status: FriendRequestStatus;
  counterpart: {
    userId: string | null;
    name: string | null;
    email: string | null;
  };
  /** ISO 8601。 */
  createdAt: string;
  /** 接受、拒絕或取消的時間；仍為 `PENDING` 時是 `null`。ISO 8601。 */
  respondedAt: string | null;
}

/** `POST /friend-requests` 的 body。 */
export interface CreateFriendRequestRequest {
  email: string;
}

/** `GET /friend-requests` 的查詢參數。 */
export interface ListFriendRequestsQuery {
  direction: FriendRequestDirection;
  status?: FriendRequestStatus;
  page?: number;
  limit?: number;
}

/**
 * `POST /friend-invite-links` 的回應。
 *
 * `token` 的原文**只在這裡出現一次**，伺服器只存它的雜湊值。前端組網址時請放在 `#` 之後
 * （例如 `/friends/invite#<token>`），瀏覽器就不會把它送給伺服器或放進 Referer。
 */
export interface FriendInviteLinkCreated {
  token: string;
  /** ISO 8601。產生後 10 分鐘。 */
  expiresAt: string;
}

/** `preview` 與 `accept` 兩個端點的 body。token 放 body 而非網址路徑，避免進存取日誌。 */
export interface FriendInviteTokenRequest {
  token: string;
}

/** `POST /friend-invite-links/preview` 的回應：讓持有者確認是誰邀請自己。 */
export interface FriendInviteLinkPreview {
  inviterName: string;
  /** ISO 8601。 */
  expiresAt: string;
}
