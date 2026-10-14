import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthUser, ErrorCode, type RecordDefaults } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toAuthUser } from './user.mapper';

/**
 * 使用者個人資料的業務邏輯（查詢／更新自己）。回傳一律經 toAuthUser 投影，
 * 確保 passwordHash 這類機敏欄位不外流。
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getById(id: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      // id 來自合法的 JWT，因此只有在 token 簽發後帳號才被刪除時才會走到這裡。
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'User not found.');
    }
    return toAuthUser(user);
  }

  async updateName(id: string, name: string): Promise<AuthUser> {
    const user = await this.prisma.user.update({ where: { id }, data: { name } });
    return toAuthUser(user);
  }

  async getRecordDefaults(userId: string, ledgerId?: string): Promise<RecordDefaults> {
    if (ledgerId) {
      // 頁面指定帳本時，先確認目前仍是成員；退出後不能靠舊交易猜到帳本是否存在。
      const membership = await this.prisma.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId } },
        select: { userId: true },
      });
      if (!membership) {
        throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
      }
    }

    const where = {
      creatorId: userId,
      deletedAt: null,
      accountId: { not: null },
      account: { is: { userId, isTemporary: false } },
    } as const;
    const select = {
      accountId: true,
      ledgerId: true,
      ledger: {
        select: {
          archivedAt: true,
          members: { where: { userId }, select: { role: true } },
        },
      },
    } as const;
    const orderBy = [{ createdAt: 'desc' as const }, { id: 'desc' as const }];

    // 固定帳本內沒有交易時，回退到帳號整體最近一次；兩種路徑套相同的帳戶隔離條件。
    const scoped = ledgerId
      ? await this.prisma.transaction.findFirst({ where: { ...where, ledgerId }, select, orderBy })
      : null;
    const recent = scoped ?? (await this.prisma.transaction.findFirst({ where, select, orderBy }));

    if (ledgerId) {
      return { ledgerId, accountId: recent?.accountId ?? null };
    }
    if (!recent) {
      return { ledgerId: null, accountId: null };
    }
    const writable =
      recent.ledger.archivedAt === null &&
      recent.ledger.members.some((member) => member.role === 'OWNER' || member.role === 'EDITOR');
    return { ledgerId: writable ? recent.ledgerId : null, accountId: recent.accountId };
  }
}
