import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_CATEGORIES,
  ErrorCode,
  LedgerDetail,
  LedgerMemberInfo,
  LedgerRole,
  LedgerSummary,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 帳本與成員的業務邏輯——授權與資料隔離的重心。個人模式與家庭模式共用同一套
 * 帳本模型，差別只在成員數與角色。
 *
 * 這裡的方法本身「不做」成員資格檢查（那由 LedgerAccessGuard 在上游把關），
 * 專注在跨成員的規則上，其中最關鍵的是「一個帳本永遠至少保留一位 owner」——
 * 降級或移除最後一位 owner 都會被擋下，且在交易內重查以避開競態。
 */

/** 從資料庫選出的帳本資料列。 */
interface LedgerRow {
  id: string;
  name: string;
  currency: string;
  createdAt: Date;
}

/** 一筆成員關聯資料列，已 join 其 user，供成員相關回應使用。 */
interface MemberRow {
  userId: string;
  role: LedgerRole;
  user: { email: string; name: string };
}

@Injectable()
export class LedgersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 建立一個由指定使用者擁有的帳本，並灌入預設分類。它跑在「呼叫端傳入的」交易
   * client 上，因此能與其他寫入（例如註冊使用者）組成同一個原子交易。
   *
   * 這裡**不建立帳戶**——帳戶屬於使用者、跨帳本共用，種子在註冊時就已備妥。
   */
  async createLedgerForUser(tx: Prisma.TransactionClient, userId: string, name: string) {
    const ledger = await tx.ledger.create({ data: { name } });

    await tx.ledgerMember.create({
      data: { ledgerId: ledger.id, userId, role: 'OWNER' },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({
        ledgerId: ledger.id,
        name: category.name,
        type: category.type,
      })),
    });

    return ledger;
  }

  /** 建立一個獨立帳本；建立者即成為 OWNER。 */
  async create(userId: string, name: string): Promise<LedgerSummary> {
    const ledger = await this.prisma.$transaction((tx) =>
      this.createLedgerForUser(tx, userId, name),
    );
    return this.toSummary(ledger, 'OWNER');
  }

  /** 列出使用者所屬的帳本，每筆附上他在該帳本的角色。 */
  async listForUser(userId: string): Promise<LedgerSummary[]> {
    const memberships = await this.prisma.ledgerMember.findMany({
      where: { userId },
      include: { ledger: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => this.toSummary(membership.ledger, membership.role));
  }

  /** 回傳帳本及其完整成員清單。存取權限在上游（guard）把關。 */
  async getDetail(ledgerId: string): Promise<LedgerDetail> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      include: { members: { include: { user: true } } },
    });
    if (!ledger) {
      throw this.notFound();
    }

    return {
      ...this.toLedger(ledger),
      members: ledger.members.map((member) => this.toMemberInfo(member)),
    };
  }

  /** 改帳本名稱，並回傳更新後的明細。 */
  async rename(ledgerId: string, name: string): Promise<LedgerDetail> {
    await this.prisma.ledger.update({ where: { id: ledgerId }, data: { name } });
    return this.getDetail(ledgerId);
  }

  /**
   * 刪除帳本（連帶 cascade 刪除成員與分類）。要求呼叫端在 `confirm` 回填帳本
   * 名稱，作為誤刪共享資料的防呆關卡。
   */
  async remove(ledgerId: string, confirm: string | undefined): Promise<void> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
    });
    if (!ledger) {
      throw this.notFound();
    }
    if (confirm !== ledger.name) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'confirm must exactly match the ledger name.',
      );
    }
    await this.prisma.ledger.delete({ where: { id: ledgerId } });
  }

  /** 列出帳本的所有成員。存取權限在上游把關。 */
  async listMembers(ledgerId: string): Promise<LedgerMemberInfo[]> {
    const members = await this.prisma.ledgerMember.findMany({
      where: { ledgerId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => this.toMemberInfo(member));
  }

  /** 以 email 查出「已註冊」的使用者並加入帳本（查無此人或已是成員都會擋下）。 */
  async addMember(ledgerId: string, email: string, role: LedgerRole): Promise<LedgerMemberInfo> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        'No registered user with that email.',
      );
    }

    const existing = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId: user.id } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_MEMBER,
        'User is already a member of this ledger.',
      );
    }

    const member = await this.prisma.ledgerMember.create({
      data: { ledgerId, userId: user.id, role },
      include: { user: true },
    });
    return this.toMemberInfo(member);
  }

  /**
   * 變更成員角色。降級帳本最後一位 owner 會被拒絕，以確保帳本永遠至少有一位
   * owner。owner 數量在交易內重查，避免與並行變更發生競態。
   */
  async updateMemberRole(
    ledgerId: string,
    targetUserId: string,
    role: LedgerRole,
  ): Promise<LedgerMemberInfo> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (target.role === 'OWNER' && role !== 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      const updated = await tx.ledgerMember.update({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
        data: { role },
        include: { user: true },
      });
      return this.toMemberInfo(updated);
    });
  }

  /**
   * 移除成員。使用者永遠可以移除自己（退出）；移除他人則要求操作者是 owner。
   * 最後一位 owner 不可被移除。
   */
  async removeMember(ledgerId: string, targetUserId: string, actingUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (targetUserId !== actingUserId) {
        const acting = await tx.ledgerMember.findUnique({
          where: { ledgerId_userId: { ledgerId, userId: actingUserId } },
        });
        if (!acting || acting.role !== 'OWNER') {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            ErrorCode.CANNOT_MANAGE_OTHER_MEMBER,
            'Only an owner can remove another member.',
          );
        }
      }

      if (target.role === 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      await tx.ledgerMember.delete({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
    });
  }

  // 帳本永遠至少一位 owner 的守門：owner 數 <= 1 時擋下降級／移除動作。
  private async assertNotLastOwner(tx: Prisma.TransactionClient, ledgerId: string): Promise<void> {
    const owners = await tx.ledgerMember.count({
      where: { ledgerId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.LAST_OWNER_CANNOT_LEAVE,
        'A ledger must always have at least one owner.',
      );
    }
  }

  private toMemberInfo(member: MemberRow): LedgerMemberInfo {
    return {
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
    };
  }

  private memberNotFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Member not found.');
  }

  private toLedger(ledger: LedgerRow) {
    return {
      id: ledger.id,
      name: ledger.name,
      currency: ledger.currency,
      createdAt: ledger.createdAt.toISOString(),
    };
  }

  private toSummary(ledger: LedgerRow, role: LedgerRole): LedgerSummary {
    return { ...this.toLedger(ledger), role };
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
}
