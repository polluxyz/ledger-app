import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { ListMarkedTransactionsQuery } from '@ledger/shared';

/** 標註列表嚴格驗證分頁範圍，避免靜默截斷客戶端指定的筆數。 */
export class ListMarkedTransactionsQueryDto implements ListMarkedTransactionsQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
