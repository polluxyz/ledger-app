import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { Friend, Paginated } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { orderPair, toFriend } from './friendship';

/**
 * 好友清單與解除好友。規格見 `docs/specs/phase-3a-friends.md` §2 決策 10、12、§5。
 *
 * 貫穿本檔的兩條規則：
 *   - **一對好友只存一筆**，id 小的在 `userLowId`（見 `friendship.ts`）。因此呼叫者可能
 *     落在任一側，每個查詢都要兩側都比對，再把「另一位」當成好友回傳。
 *   - **只讀得到自己的清單**。這裡沒有任何方法接受「別人的 userId」當查詢對象，
 *     `remove` 的第二個參數是「要解除的那位好友」，動到的仍然是呼叫者自己的關係
 *     （spec §3.3，SEC-19）。
 */

// 分頁預設值與每頁筆數上限。超過上限時夾住，不報錯（與 transactions 一致）。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 好友關係的一列，已 join 兩側使用者。只取 `id` 與 `name`——回應刻意不含 email。 */
const FRIENDSHIP_INCLUDE = {
  userLow: { select: { id: true, name: true } },
  userHigh: { select: { id: true, name: true } },
} as const;

@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 呼叫者的好友清單，依成為好友的時間新到舊，分頁。 */
  async list(userId: string, query: { page?: number; limit?: number }): Promise<Paginated<Friend>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // 呼叫者可能是 low 或 high 的一側，兩側都要比對，否則清單只剩一半。
    const where = { OR: [{ userLowId: userId }, { userHighId: userId }] };

    const [rows, total] = await Promise.all([
      this.prisma.friendship.findMany({
        where,
        include: FRIENDSHIP_INCLUDE,
        // 同一毫秒成立的兩段關係會並列，補上主鍵當決勝鍵，分頁才不會漏抓或重複。
        orderBy: [{ createdAt: 'desc' }, { userLowId: 'asc' }, { userHighId: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.friendship.count({ where }),
    ]);

    return {
      items: rows.map((row) =>
        toFriend(row.userLowId === userId ? row.userHigh : row.userLow, row.createdAt),
      ),
      page,
      limit,
      total,
    };
  }

  /**
   * 解除好友。單方動作，不需對方同意（決策 12）。
   *
   * 既有的好友邀請保持原狀當作歷史紀錄——只有 `PENDING` 的邀請會擋住重新邀請，
   * 而能成為好友的那一筆早就不是 `PENDING` 了，所以之後重新邀請不受影響。
   *
   * 階段 3b 會在這裡延伸：解除好友時，連動中的債務自動轉成雙方各自的單邊記錄
   * （見《專案決策脈絡.md》「階段三定案」）。3a 還沒有債務，本步不實作。
   */
  async remove(userId: string, friendUserId: string): Promise<void> {
    // 先擋自己。`orderPair` 對兩個相同的 id 會直接丟出，不能讓它走到那裡。
    if (friendUserId === userId) {
      throw this.friendNotFound();
    }

    const { count } = await this.prisma.friendship.deleteMany({
      where: orderPair(userId, friendUserId),
    });
    if (count === 0) {
      throw this.friendNotFound();
    }
  }

  /** 本來就不是好友。訊息不區分「沒這個人」與「不是好友」，不洩漏對方存不存在。 */
  private friendNotFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Friend not found.');
  }
}
