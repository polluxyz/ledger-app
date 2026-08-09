import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsIn, IsOptional, IsUUID, Min } from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { ListTransactionsQuery, TransactionType } from '@ledger/shared';

/**
 * 交易列表查詢字串的驗證形狀（分頁＋篩選）。
 *
 * 所有欄位皆可選；預設值（page 1、limit 20）與 limit 上限由 service 套用。
 * query string 的值一律是字串，因此 `page`／`limit` 用 `@Type(() => Number)`
 * 先轉成數字，才輪到 `@IsInt`／`@Min` 檢查——少了它，"20" 會過不了整數驗證。
 */
export class ListTransactionsQueryDto implements ListTransactionsQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;
}
