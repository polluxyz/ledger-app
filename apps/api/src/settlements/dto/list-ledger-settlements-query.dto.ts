import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';
import type { ListLedgerSettlementsQuery } from '@ledger/shared';

/**
 * 結清清單查詢字串的驗證形狀（3g §4.2），只有分頁。上下限比照交易列表：
 * 預設 page 1、limit 20，limit 超過 100 由 service 夾住。
 *
 * query string 的值一律是字串，因此 `page`／`limit` 用 `@Type(() => Number)`
 * 先轉成數字，才輪得到 `@IsInt`／`@Min` 檢查——少了它，"20" 會過不了整數驗證。
 */
export class ListLedgerSettlementsQueryDto implements ListLedgerSettlementsQuery {
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
}
