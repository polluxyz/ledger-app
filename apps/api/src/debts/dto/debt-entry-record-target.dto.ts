import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';
import type { DebtEntryRecordTarget } from '@ledger/shared';

/**
 * 「這筆往來要記成哪本帳本、哪個帳戶的交易」。
 *
 * 帳本權限（EDITOR 以上、未封存）與帳戶規則（本人一般帳戶必填，免除等種類除外）要查資料庫，
 * DTO 看不到，由 service 用 `assertLedgerWritable` 與 `TransactionsService` 把關。
 */
export class DebtEntryRecordTargetDto implements DebtEntryRecordTarget {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ledgerId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '借出、借入、還款、代墊必填，須為本人一般帳戶；PAID_FOR_ME、RECEIVED_FOR_ME 與免除不可填。',
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;
}
