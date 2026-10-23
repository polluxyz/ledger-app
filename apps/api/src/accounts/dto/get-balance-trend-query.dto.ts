import type { GetBalanceTrendQuery } from '@ledger/shared';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

/** 只接受月份與長度；曆月存在性由共用台灣期間函式驗證，不能指定其他人的資產範圍。 */
export class GetBalanceTrendQueryDto implements GetBalanceTrendQuery {
  @ApiProperty({ example: '2026-10', pattern: '^\\d{4}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}$/)
  endMonth!: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 24, default: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months?: number;
}
