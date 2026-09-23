import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type {
  FriendRequest,
  FriendRequestStatus,
  ListFriendRequestsQuery,
  Paginated,
} from '@ledger/shared';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { alreadyFriends, areFriends, cannotFriendSelf, createFriendship } from './friendship';

/**
 * 以 email 送出的好友邀請：送出、列出、接受、拒絕、取消。規格見
 * `docs/specs/phase-3a-friends.md` §2、§3.1、§3.3、§5。
 *
 * 三件事貫穿整個檔案：
 *
 * 1. **授權在這裡做，不在 guard。** 「誰能做這個動作」取決於呼叫者是這筆邀請的發起者、
 *    收件者還是外人，要先讀出邀請才知道。外人一律 404（不讓他知道邀請存在），當事人
 *    但動作不對回 403。角色檢查排在狀態檢查之前——否則「發起者對一筆已拒絕的邀請按
 *    接受」會拿到 409，等於告訴他這筆邀請的狀態。
 * 2. **回應裡的對方資訊依方向與狀態而不同**（決策 10、11），全部集中在 `toFriendRequest`。
 * 3. **狀態轉換用條件式更新**（`status: 'PENDING'` 當更新條件）。先讀後寫之間可能有另一個
 *    請求先改掉狀態，只靠讀出來的值判斷會讓兩個動作都成立。
 *
 * 好友關係一律經由 `friendship.ts` 的共用函式讀寫，不在這裡直接操作 `Friendship`。
 */

// 分頁預設值與每頁筆數上限（客戶端要求超過 MAX_LIMIT 時會被夾住，而非報錯）。
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * 每次讀出邀請都要一併帶出的雙方資料。收件者多帶 `email`：那是發起者自己輸入的值，
 * 只回給發起者看（決策 11）。發起者不帶 `email`——收件者從沒拿到過它。
 */
const REQUEST_INCLUDE = {
  requester: { select: { id: true, name: true } },
  recipient: { select: { id: true, name: true, email: true } },
} as const;

/** 一筆已 join 雙方資料的邀請。刻意只列出對應所需的欄位，多出來的欄位不影響。 */
interface FriendRequestRow {
  id: string;
  requesterId: string;
  recipientId: string;
  status: FriendRequestStatus;
  respondedAt: Date | null;
  createdAt: Date;
  requester: { id: string; name: string };
  recipient: { id: string; name: string; email: string };
}

/** 接受、拒絕、取消三個動作各自要求的當事人角色。 */
type ActingParty = 'requester' | 'recipient';

@Injectable()
export class FriendRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /**
   * 以 email 送出邀請。檢查順序就是錯誤的優先順序，不可對調：先確定這個人存在，
   * 才談得上「是不是我自己」「是不是已經是好友」。
   *
   * 決策 8 的捷徑在第 4 步：對方已經邀請過我，雙方都表達了意願，直接成立好友關係，
   * 回傳的是**對方那筆邀請**（狀態已改成 `ACCEPTED`），不另建一筆。
   *
   * 被拒絕後沒有冷卻期（決策 9）：`DECLINED` 的舊邀請不會擋下新的一筆。
   */
  async create(userId: string, email: string): Promise<FriendRequest> {
    const target = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });
    if (target === null) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        'No registered user has that email.',
      );
    }
    if (target.id === userId) {
      throw cannotFriendSelf();
    }
    if (await areFriends(this.prisma, userId, target.id)) {
      throw alreadyFriends();
    }

    const reverse = await this.prisma.friendRequest.findFirst({
      where: { requesterId: target.id, recipientId: userId, status: 'PENDING' },
      include: REQUEST_INCLUDE,
    });
    if (reverse !== null) {
      return this.acceptRow(reverse, userId);
    }

    const ownPending = await this.prisma.friendRequest.findFirst({
      where: { requesterId: userId, recipientId: target.id, status: 'PENDING' },
      select: { id: true },
    });
    if (ownPending !== null) {
      throw this.requestPending();
    }

    try {
      const created = await this.prisma.friendRequest.create({
        data: { requesterId: userId, recipientId: target.id },
        include: REQUEST_INCLUDE,
      });
      return this.toFriendRequest(created, userId);
    } catch (error) {
      // 部分唯一索引 `FriendRequest_one_pending_per_pair` 擋下同時送達的第二筆。
      // 上面的檢查處理一般情況，這裡處理兩個請求同時通過檢查的競態。
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.requestPending();
      }
      throw error;
    }
  }

  /**
   * 列出收到的或送出的邀請。`direction` 決定用哪一個欄位比對呼叫者——所以這個查詢
   * 天生就限定在呼叫者自己的邀請，沒有「查別人的清單」這種形狀存在。
   */
  async list(userId: string, query: ListFriendRequestsQuery): Promise<Paginated<FriendRequest>> {
    const page = query.page ?? DEFAULT_PAGE;
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    const where: Prisma.FriendRequestWhereInput = {
      ...(query.direction === 'incoming' ? { recipientId: userId } : { requesterId: userId }),
      ...(query.status ? { status: query.status } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.friendRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.friendRequest.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toFriendRequest(row, userId)),
      page,
      limit,
      total,
    };
  }

  /** 收件者接受邀請：標記 `ACCEPTED`，並在同一個交易裡建立好友關係。 */
  async accept(userId: string, requestId: string): Promise<FriendRequest> {
    const row = await this.loadForAction(userId, requestId, 'recipient');
    return this.acceptRow(row, userId);
  }

  /** 收件者拒絕邀請。沒有冷卻期，發起者可以立刻重送（決策 9）。 */
  async decline(userId: string, requestId: string): Promise<FriendRequest> {
    const row = await this.loadForAction(userId, requestId, 'recipient');
    return this.settle(row, userId, 'DECLINED');
  }

  /** 發起者取消自己送出的邀請。 */
  async cancel(userId: string, requestId: string): Promise<FriendRequest> {
    const row = await this.loadForAction(userId, requestId, 'requester');
    return this.settle(row, userId, 'CANCELLED');
  }

  /**
   * 讀出邀請並檢查呼叫者能不能做這個動作。檢查順序見本類別的檔頭第 1 點。
   *
   * 任何一種拒絕都在寫入之前發生，所以被拒絕的請求不會留下任何痕跡。
   */
  private async loadForAction(
    userId: string,
    requestId: string,
    required: ActingParty,
  ): Promise<FriendRequestRow> {
    const row = await this.prisma.friendRequest.findUnique({
      where: { id: requestId },
      include: REQUEST_INCLUDE,
    });

    const isRequester = row !== null && row.requesterId === userId;
    const isRecipient = row !== null && row.recipientId === userId;
    // 找不到，與「找得到但呼叫者不是當事人」回同一個錯誤：外人不該分辨得出來。
    if (row === null || (!isRequester && !isRecipient)) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Friend request not found.',
      );
    }

    const isRightParty = required === 'requester' ? isRequester : isRecipient;
    if (!isRightParty) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        required === 'requester'
          ? 'Only the requester can cancel this friend request.'
          : 'Only the recipient can respond to this friend request.',
      );
    }

    if (row.status !== 'PENDING') {
      throw this.notPending();
    }

    return row;
  }

  /**
   * 把一筆 `PENDING` 邀請改成 `ACCEPTED` 並建立好友關係，兩件事在同一個交易裡——
   * 只成立一半的話，邀請會永遠停在「已接受但不是好友」。
   *
   * `areFriends` 先查一次：雙方可能已經透過邀請連結成為好友，那時仍要把邀請標記成
   * `ACCEPTED`（否則它會永遠掛在清單上），但不能再建一筆好友關係。
   */
  private async acceptRow(row: FriendRequestRow, viewerId: string): Promise<FriendRequest> {
    const respondedAt = this.now();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.friendRequest.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'ACCEPTED', respondedAt },
      });
      if (updated.count === 0) {
        throw this.notPending();
      }

      if (!(await areFriends(tx, row.requesterId, row.recipientId))) {
        await createFriendship(tx, row.requesterId, row.recipientId);
      }

      return this.toFriendRequest({ ...row, status: 'ACCEPTED', respondedAt }, viewerId);
    });
  }

  /** 把一筆 `PENDING` 邀請推進到終點狀態（拒絕或取消），不牽涉好友關係。 */
  private async settle(
    row: FriendRequestRow,
    viewerId: string,
    status: 'DECLINED' | 'CANCELLED',
  ): Promise<FriendRequest> {
    const respondedAt = this.now();

    // 條件式更新：另一個請求若在讀出之後先改掉狀態，這裡會是 0 筆，不會覆蓋它的結果。
    const updated = await this.prisma.friendRequest.updateMany({
      where: { id: row.id, status: 'PENDING' },
      data: { status, respondedAt },
    });
    if (updated.count === 0) {
      throw this.notPending();
    }

    return this.toFriendRequest({ ...row, status, respondedAt }, viewerId);
  }

  /**
   * 把一列邀請轉成回應。對方資訊依方向與狀態而不同（決策 10、11）：
   *
   * - 收到的邀請：帶發起者的 `userId` 與 `name`。對方主動找上我，知道他是誰才能決定。
   * - 我送出、尚未被接受的：只帶我自己輸入的 `email`。否則「知道一個 email」就能換到
   *   「這個人的名字」。
   * - 我送出、已被接受的：對方已是好友，帶 `userId` 與 `name`，`email` 收回。
   */
  private toFriendRequest(row: FriendRequestRow, viewerId: string): FriendRequest {
    const incoming = row.recipientId === viewerId;
    const counterpart = incoming
      ? { userId: row.requester.id, name: row.requester.name, email: null }
      : row.status === 'ACCEPTED'
        ? { userId: row.recipient.id, name: row.recipient.name, email: null }
        : { userId: null, name: null, email: row.recipient.email };

    return {
      id: row.id,
      direction: incoming ? 'incoming' : 'outgoing',
      status: row.status,
      counterpart,
      createdAt: row.createdAt.toISOString(),
      respondedAt: row.respondedAt === null ? null : row.respondedAt.toISOString(),
    };
  }

  private requestPending(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.FRIEND_REQUEST_PENDING,
      'You already have a pending friend request to that person.',
    );
  }

  private notPending(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.FRIEND_REQUEST_NOT_PENDING,
      'This friend request has already been answered.',
    );
  }
}
