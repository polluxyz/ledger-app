import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { Friend } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';

/**
 * 好友關係（`Friendship`）的共用讀寫函式。好友邀請（T4）、邀請連結（T5）、好友清單（T6）
 * 三條路徑都會建立或查詢好友關係，**一律經過這裡**，不要各自直接操作 `Friendship`。
 *
 * 核心規則只有一條：一對好友只存一筆，id 小的放 `userLowId`。存兩筆的話，只要有一條
 * 路徑漏寫一筆，關係就只剩單邊。資料庫的 CHECK 約束 `Friendship_ordered` 是最後防線。
 */

/** 能對 `Friendship` 讀寫的 client：一般的 PrismaService，或 `$transaction` 裡的 tx。 */
type FriendshipClient = Pick<Prisma.TransactionClient, 'friendship'>;

/**
 * 把兩個 userId 排成 `{ userLowId, userHighId }`。
 *
 * 用 JavaScript 的 `<` 比較字串，依 UTF-16 code unit 排序。資料庫那一側的 CHECK 約束
 * 用 `COLLATE "C"`（位元組順序）比較。UUID 只含 `0-9a-f-`，兩種順序完全一致。
 *
 * 兩個 id 相同是呼叫端的錯誤（「加自己為好友」要在更早的地方以 `CANNOT_FRIEND_SELF`
 * 擋下），這裡直接丟出，不包成使用者看得到的錯誤。
 */
export function orderPair(a: string, b: string): { userLowId: string; userHighId: string } {
  if (a === b) {
    throw new Error('orderPair: a user cannot be paired with themselves');
  }
  return a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a };
}

/** 兩人是否已是好友。 */
export async function areFriends(client: FriendshipClient, a: string, b: string): Promise<boolean> {
  const row = await client.friendship.findUnique({
    where: { userLowId_userHighId: orderPair(a, b) },
    select: { userLowId: true },
  });
  return row !== null;
}

/**
 * 建立好友關係，回傳成為好友的時間。
 *
 * 已經是好友時丟 `409 ALREADY_FRIENDS`。呼叫端應該先用 `areFriends` 檢查並回同一個錯誤；
 * 這裡接住主鍵衝突（Prisma `P2002`），處理的是兩個請求同時成立同一對好友的競態。
 */
export async function createFriendship(
  client: FriendshipClient,
  a: string,
  b: string,
): Promise<Date> {
  try {
    const row = await client.friendship.create({ data: orderPair(a, b) });
    return row.createdAt;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw alreadyFriends();
    }
    throw error;
  }
}

export function alreadyFriends(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.ALREADY_FRIENDS,
    'You are already friends.',
  );
}

export function cannotFriendSelf(): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.CANNOT_FRIEND_SELF,
    'You cannot add yourself as a friend.',
  );
}

/** 好友清單的一列。只帶 `userId`、`name`、`since`——刻意不含 email（spec 決策 10）。 */
export function toFriend(user: { id: string; name: string }, since: Date): Friend {
  return { userId: user.id, name: user.name, since: since.toISOString() };
}
