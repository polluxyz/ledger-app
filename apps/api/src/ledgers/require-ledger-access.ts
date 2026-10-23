import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type LedgerRole } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { PrismaService } from '../prisma/prisma.service';

/** 成員、角色、封存依序把關，讓路徑參數與 body 帳本共用相同的授權邊界。 */
export async function requireLedgerAccess(
  prisma: PrismaService,
  userId: string,
  ledgerId: string,
  minimumRole: LedgerRole,
  allowArchived: boolean,
): Promise<LedgerRole> {
  const membership = await prisma.ledgerMember.findUnique({
    where: { ledgerId_userId: { ledgerId, userId } },
  });
  if (!membership) {
    throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
  const rank: Record<LedgerRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };
  if (rank[membership.role] < rank[minimumRole]) {
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'You do not have permission to perform this action on this ledger.',
    );
  }
  if (!allowArchived) {
    const ledger = await prisma.ledger.findUnique({
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
  return membership.role;
}
