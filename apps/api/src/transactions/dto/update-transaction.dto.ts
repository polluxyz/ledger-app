import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { TransactionType, UpdateTransactionRequest } from '@ledger/shared';

/**
 * PATCH body 的驗證形狀：每個欄位都可選，呼叫端只需送要變更的欄位。有出現的
 * 欄位仍套用與建立時相同的規則；合併後由 service 整組重驗型別、分類與帳戶。
 *
 * 沒有「清空」的表達方式（`undefined` 一律代表「不動」）。唯一需要清空的情境
 * 是把交易改成 `TRANSFER`——那時 service 會自動把分類設為 null，因此客戶端
 * 毋須理解 `undefined` 與 `null` 的差別，也做不出「轉帳卻帶分類」的非法狀態。
 */
export class UpdateTransactionDto implements UpdateTransactionRequest {
  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;

  @ApiPropertyOptional({ description: 'Positive integer, minor unit.' })
  @IsOptional()
  @IsInt()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** 只有這次「指定」的帳戶會被驗證所有權；沿用不動的既有帳戶可能屬於別的成員。 */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
