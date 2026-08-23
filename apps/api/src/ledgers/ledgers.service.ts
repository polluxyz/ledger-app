import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_CATEGORIES,
  ErrorCode,
  LedgerDetail,
  LedgerKind,
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
  kind: LedgerKind;
  tracksBalance: boolean;
  archivedAt: Date | null;
  createdAt: Date;
}

/**
 * 建立帳本所需的欄位。用具名物件而非一串位置參數——`name` 之後接的是一個布林
 * 與一個列舉，寫成 `create(userId, name, true, 'SHARED')` 的話，呼叫端讀起來
 * 認不出哪個是哪個。
 */
interface CreateLedgerInput {
  name: string;
  /** 省略時為 `PERSONAL`。建立後不可變更。 */
  kind?: LedgerKind;
  /** 省略時為 `true`。建立後不可變更。 */
  tracksBalance?: boolean;
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
  async createLedgerForUser(
    tx: Prisma.TransactionClient,
    userId: string,
    input: CreateLedgerInput,
  ) {
    const { name, tracksBalance = true, kind = 'PERSONAL' } = input;
    const ledger = await tx.ledger.create({ data: { name, tracksBalance, kind } });

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
  async create(userId: string, input: CreateLedgerInput): Promise<LedgerSummary> {
    const ledger = await this.prisma.$transaction((tx) =>
      this.createLedgerForUser(tx, userId, input),
    );
    return this.toSummary(ledger, 'OWNER');
  }

  /**
   * 列出使用者所屬的帳本，每筆附上他在該帳本的角色。
   * 預設排除已封存的——封存的用意就是「從日常視野收起來」。
   */
  async listForUser(userId: string, includeArchived = false): Promise<LedgerSummary[]> {
    const memberships = await this.prisma.ledgerMember.findMany({
      where: {
        userId,
        ...(includeArchived ? {} : { ledger: { archivedAt: null } }),
      },
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

  /**
   * 改帳本名稱，並回傳更新後的明細。
   *
   * `tracksBalance` 與 `kind` 明確擋在這裡，兩者都是建立後即定案的欄位：
   *
   * - `tracksBalance` 決定帳本裡的交易算不算進餘額，事後翻轉會讓每個成員的餘額
   *   瞬間跳動，而畫面上沒有任何線索說明數字為何變了。
   * - `kind` 決定這本帳本能不能加人。事後翻轉等於讓「誰看得到我的帳」在使用者
   *   沒有心理準備的情況下改變。
   */
  async rename(
    ledgerId: string,
    name: string,
    tracksBalance?: boolean,
    kind?: LedgerKind,
  ): Promise<LedgerDetail> {
    if (tracksBalance !== undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.TRACKS_BALANCE_IMMUTABLE,
        'tracksBalance is fixed when the ledger is created and cannot be changed.',
      );
    }
    if (kind !== undefined) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.LEDGER_KIND_IMMUTABLE,
        'kind is fixed when the ledger is created and cannot be changed.',
      );
    }
    await this.prisma.ledger.update({ where: { id: ledgerId }, data: { name } });
    return this.getDetail(ledgerId);
  }

  /**
   * 封存帳本：轉為唯讀，且預設不再出現在帳本清單中。
   *
   * 這是「結束一本帳本」的正常途徑，刪除則是例外（見 `remove`）。
   *
   * 走 HTTP 進來時，重複封存會先被 `LedgerAccessGuard` 擋成 409（封存的帳本
   * 一律不可寫入）；這裡仍保留「已封存就不覆寫時間」的判斷，讓 service 自身
   * 不依賴 guard 也是安全的——封存時間是稽核資訊，不該被第二次呼叫抹掉。
   */
  async archive(ledgerId: string): Promise<LedgerDetail> {
    const ledger = await this.prisma.ledger.findUnique({ where: { id: ledgerId } });
    if (!ledger) {
      throw this.notFound();
    }
    if (!ledger.archivedAt) {
      await this.prisma.ledger.update({
        where: { id: ledgerId },
        data: { archivedAt: new Date() },
      });
    }
    return this.getDetail(ledgerId);
  }

  /**
   * 刪除帳本（連帶 cascade 刪除成員、分類與交易）。有兩道關卡：
   *
   * 1. 呼叫端要在 `confirm` 回填帳本名稱，防手滑；
   * 2. **帳本內若有其他成員記的交易，一律不准刪**——那些交易掛在對方的帳戶上，
   *    刪掉會讓對方的餘額被回溯性改變，而他甚至不會知道發生了什麼事。這種情況
   *    請改用封存。只有自己記的（或空的）帳本才收得掉，好讓人能清掉建錯的帳本。
   */
  async remove(ledgerId: string, actingUserId: string, confirm: string | undefined): Promise<void> {
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

    // 計數不過濾 deletedAt：軟刪除的交易仍是別人的紀錄，且仍佔著他的帳戶引用。
    const othersTransactions = await this.prisma.transaction.count({
      where: { ledgerId, creatorId: { not: actingUserId } },
    });
    if (othersTransactions > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.LEDGER_HAS_OTHERS_TRANSACTIONS,
        'This ledger holds transactions recorded by other members; archive it instead.',
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

  /**
   * 以 email 查出「已註冊」的使用者並加入帳本（查無此人或已是成員都會擋下）。
   *
   * **私人帳本一律擋下，owner 本人也不例外**——那不是權限不足，是帳本的類型不允許。
   * 前端不會為私人帳本畫出「新增成員」的按鈕，但那只是體驗：Swagger UI 就開在
   * `/docs`，規則若不寫在這裡就等於不存在。
   *
   * 檢查順序有意義：帳本類型排在「查詢目標使用者」之前。反過來的話，對私人帳本送
   * 一個沒註冊的 email 會拿到 `USER_NOT_FOUND`，那洩漏了該 email 未註冊，而呼叫者
   * 本就無權對這本帳本做任何成員操作。
   */
  async addMember(ledgerId: string, email: string, role: LedgerRole): Promise<LedgerMemberInfo> {
    const ledger = await this.prisma.ledger.findUnique({ where: { id: ledgerId } });
    if (!ledger) {
      throw this.notFound();
    }
    if (ledger.kind === 'PERSONAL') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PERSONAL_LEDGER_CANNOT_SHARE,
        'This is a personal ledger; create a shared ledger to record with others.',
      );
    }

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
      kind: ledger.kind,
      tracksBalance: ledger.tracksBalance,
      archivedAt: ledger.archivedAt?.toISOString() ?? null,
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
