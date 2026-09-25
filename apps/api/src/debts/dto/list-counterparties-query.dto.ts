import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { ListCounterpartiesQuery } from '@ledger/shared';

/**
 * `GET /counterparties` 與 `GET /counterparties/{id}/entries` 的查詢字串。
 * 分頁預設與上限由 service 套用。
 */
export class ListCounterpartiesQueryDto implements ListCounterpartiesQuery {
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
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'GET /counterparties only: names containing this text (case-insensitive).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}
