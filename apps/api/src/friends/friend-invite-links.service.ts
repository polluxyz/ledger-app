import { createHash, randomBytes } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type {
  LinkAccepted,
  FriendInviteLinkCreated,
  FriendInviteLinkPreview,
} from '@ledger/shared';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { establishLink } from '../debts/counterparty-links';
import { cannotFriendSelf } from './friendship';

/** 連結壽命：10 分鐘（spec 決策 6）。主要用途是當面掃 QR code，短壽命讓外流的損害也短。 */
const INVITE_LINK_TTL_MS = 10 * 60 * 1000;

/** token 的位元組數。32 bytes 以 base64url 編碼後固定是 43 個字元。 */
const TOKEN_BYTES = 32;

/**
 * token 的原文只在產生當下回給產生者一次，資料庫只存這個雜湊值（spec §3.4）。
 *
 * 用 SHA-256 而非 bcrypt：token 是 32 bytes 的密碼學隨機值，熵值本來就夠高，
 * 沒有「猜得中」的問題，不需要慢速雜湊來拖慢暴力破解。
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 連結失效的唯一對外錯誤。
 *
 * 查無此連結、已使用、已撤銷、已過期，四種情況一律回同一個 404（spec §3.2）。
 * 分開說明既幫不上使用者（補救方法都是「請對方重新產生」），又等於告訴持有者
 * 「這個 token 存在過」。訊息裡永遠不帶 token。
 */
function inviteLinkInvalid(): AppException {
  return new AppException(
    HttpStatus.NOT_FOUND,
    ErrorCode.INVITE_LINK_INVALID,
    'This invite link is no longer valid. Ask for a new one.',
  );
}

/** 連結是否有效：未使用、未撤銷，且此刻早於到期時間（spec §3.2）。 */
function isUsable(
  link: { usedAt: Date | null; revokedAt: Date | null; expiresAt: Date },
  now: Date,
): boolean {
  return link.usedAt === null && link.revokedAt === null && now < link.expiresAt;
}

/**
 * 好友邀請連結：產生、預覽、接受。規格見 `docs/specs/phase-3a-friends.md` §2 決策 5～7、
 * §3.2、§3.4、§5。
 *
 * 兩件事貫穿整個檔案：
 * 1. **token 原文只進出記憶體**，不寫進資料庫、日誌或錯誤訊息，落地的一律是 SHA-256。
 * 2. **「現在」一律取自注入的時鐘 `this.now()`**，測試才有辦法驗 10 分鐘過期。
 *
 * `Friendship` 的讀寫全部走 `friendship.ts` 的共用函式，不直接碰 `prisma.friendship`。
 */
@Injectable()
export class FriendInviteLinksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  /**
   * 產生新連結，並讓自己舊的有效連結同時失效（spec 決策 7）。
   *
   * 每人同時只有一條有效連結，等於內建撤銷，不必另做撤銷端點。撤銷與建立放進同一個
   * 交易：若只成功一半，使用者會同時留著兩條有效連結，或一條都不剩。
   */
  async create(userId: string): Promise<FriendInviteLinkCreated> {
    const now = this.now();
    const expiresAt = new Date(now.getTime() + INVITE_LINK_TTL_MS);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');

    await this.prisma.$transaction(async (tx) => {
      await tx.friendInviteLink.updateMany({
        where: { inviterId: userId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { revokedAt: now },
      });
      await tx.friendInviteLink.create({
        data: {
          inviterId: userId,
          tokenHash: hashToken(token),
          expiresAt,
        },
      });
    });

    return { token, expiresAt: expiresAt.toISOString() };
  }

  /**
   * 預覽：讓持有者在按下接受之前，先確認是誰邀請自己。
   *
   * 預覽**不消耗連結**（spec §5）。端點仍需登入，但不看呼叫者是誰：任何拿到 token 的人都能看，
   * 所以回應只給產生者的顯示名稱，不含 email 或 userId。
   */
  async preview(token: string): Promise<FriendInviteLinkPreview> {
    const link = await this.prisma.friendInviteLink.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { inviter: { select: { id: true, name: true } } },
    });
    if (link === null || !isUsable(link, this.now())) {
      throw inviteLinkInvalid();
    }
    return {
      inviterName: link.inviter.name,
      expiresAt: link.expiresAt.toISOString(),
    };
  }

  /**
   * 接受連結：直接成為好友並連動，產生者不必再確認（決策 73～75）。
   *
   * 檢查順序是刻意的：
   * - 已連動由 `establishLink` 擋下；它與 token 消耗在同一交易，失敗就不消耗。
   * - 消耗用條件式的 `updateMany`，把「仍然有效」寫進 `where`。兩人同時用同一條連結時，
   *   資料庫只會讓其中一次的 `count` 是 1，另一人拿到 404。先讀再寫的判斷擋不住這種競態。
   */
  async accept(userId: string, token: string): Promise<LinkAccepted> {
    const tokenHash = hashToken(token);

    return this.prisma.$transaction(async (tx) => {
      const now = this.now();
      const link = await tx.friendInviteLink.findUnique({
        where: { tokenHash },
        include: { inviter: { select: { id: true, name: true } } },
      });
      if (link === null || !isUsable(link, now)) {
        throw inviteLinkInvalid();
      }
      if (link.inviterId === userId) {
        throw cannotFriendSelf();
      }
      const consumed = await tx.friendInviteLink.updateMany({
        where: { id: link.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now, usedById: userId },
      });
      if (consumed.count !== 1) {
        throw inviteLinkInvalid();
      }

      const accepted = await establishLink(tx, { inviterId: link.inviterId, accepterId: userId });
      return { ...accepted, otherUser: link.inviter };
    });
  }
}
