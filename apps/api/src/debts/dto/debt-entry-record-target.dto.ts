import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { DebtEntryRecordTarget } from '@ledger/shared';

/**
 * 「這筆往來要記成哪本帳本、哪個帳戶的交易」。
 *
 * 帳本權限（EDITOR 以上、未封存）與帳戶規則（連動帳本必填、帳戶屬於本人）要查資料庫，
 * DTO 看不到，由 service 用 `assertLedgerWritable` 與 `TransactionsService` 把關。
 */
export class DebtEntryRecordTargetDto implements DebtEntryRecordTarget {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ledgerId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      "Required when the ledger tracks balances; must be the caller's own account. Not allowed for PAID_FOR_ME.",
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
