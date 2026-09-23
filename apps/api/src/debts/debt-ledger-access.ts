import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { LedgerRole } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import type { Prisma } from '../generated/prisma/client';

/**
 * 「這個人能不能把一筆借還交易記進這本帳本」。
 *
 * 為什麼不直接用 `LedgerAccessGuard`：債務端點是 `/debts/...`，帳本 id 在 body 裡而不在
 * 路徑上，guard 看不到它。所以在 service 裡重做一次**完全相同**的檢查——錯誤碼、HTTP
 * 狀態與訊息都逐字對齊 guard，讓同一本帳本不論從交易端點還是債務端點寫入，得到的回應
 * 都一樣（SC-D10 的 e2e 會兩邊一起打來比對）。改 guard 時這裡要一起改。
 *
 * 規則（與 guard 相同）：
 * 1. 不是成員 → 404。不透露「有一本你無權存取的帳本存在」。
 * 2. 是成員但角色低於 EDITOR → 403。
 * 3. 帳本已封存 → 409 `LEDGER_ARCHIVED`。封存的帳本唯讀。
 */

const ROLE_RANK: Record<LedgerRole, number> = { VIEWER: 1, EDITOR: 2, OWNER: 3 };

type LedgerAccessClient = Pick<Prisma.TransactionClient, 'ledgerMember'>;

export async function assertLedgerWritable(
  client: LedgerAccessClient,
  userId: string,
  ledgerId: string,
): Promise<void> {
  const membership = await client.ledgerMember.findUnique({
    where: { ledgerId_userId: { ledgerId, userId } },
    select: { role: true, ledger: { select: { archivedAt: true } } },
  });

  if (membership === null) {
    throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
  if (ROLE_RANK[membership.role] < ROLE_RANK.EDITOR) {
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
      'You do not have permission to perform this action on this ledger.',
    );
  }
  if (membership.ledger.archivedAt !== null) {
    throw new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.LEDGER_ARCHIVED,
      'This ledger is archived and can no longer be modified.',
    );
  }
}
