import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, JwtPayload, LedgerRole } from '@ledger/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { REQUIRE_LEDGER_ROLE_KEY } from '../../common/decorators/require-ledger-role.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** 數字越大權限越高，用來比較角色是否達到門檻。 */
const ROLE_RANK: Record<LedgerRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

interface LedgerScopedRequest {
  user: JwtPayload;
  params: { ledgerId?: string };
  method: string;
  ledgerRole?: LedgerRole;
}

/**
 * 為標了 @RequireLedgerRole() 的路由把關「帳本成員資格與角色」，並在同一處
 * 攔下對**已封存帳本**的寫入。它在全域 JwtAuthGuard 之後執行，因此
 * request.user 已就緒。
 *
 * 安全性：非成員回 404（而非 403），讓 API 絕不洩漏「有一個你無權存取的帳本
 * 存在」。預設拒絕——沒標這個裝飾器的路由，視為與帳本無關，直接放行不檢查。
 *
 * 封存檢查為什麼放在 guard 而不是各 service：帳本範圍的寫入端點散布在交易、
 * 分類、成員、帳本本身等多個 controller，逐一加檢查等於為「日後新增端點時忘記
 * 加」留了一道門，而那種疏漏不會拋錯，只會讓封存的帳本悄悄可寫。集中在這裡，
 * 任何標了 @RequireLedgerRole 的新端點都自動受保護。
 */
@Injectable()
export class LedgerAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<LedgerRole | undefined>(
      REQUIRE_LEDGER_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    // 沒有 @RequireLedgerRole 的路由＝非帳本範圍，直接放行（此 guard 不管）。
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<LedgerScopedRequest>();
    const userId = request.user.sub;
    const ledgerId = request.params.ledgerId;
    if (!ledgerId) {
      // 標了 @RequireLedgerRole 的路由一定要有 :ledgerId 參數；走到這裡代表設定錯了。
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    const membership = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });

    // 非成員：回 404 而非 403——不洩漏這個帳本存在。
    if (!membership) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    if (ROLE_RANK[membership.role] < ROLE_RANK[required]) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have permission to perform this action on this ledger.',
      );
    }

    // 封存的帳本轉為唯讀：GET 一律放行（歷史紀錄必須看得到），其餘方法擋下。
    if (request.method !== 'GET') {
      const ledger = await this.prisma.ledger.findUnique({
        where: { id: ledgerId },
        select: { archivedAt: true },
      });
      if (ledger?.archivedAt) {
        throw new AppException(
          HttpStatus.CONFLICT,
          ErrorCode.LEDGER_ARCHIVED,
          'This ledger is archived and can no longer be modified.',
        );
      }
    }

    // 把解析出的角色掛回 request，供後續 handler 需要時取用。
    request.ledgerRole = membership.role;
    return true;
  }
}
