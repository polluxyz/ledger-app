import { Type } from 'class-transformer';
import { IsEnum, IsInt, Matches, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  GetLedgerStatisticsQuery,
  GetStatisticsTrendQuery,
  StatisticsPerspective,
} from '@ledger/shared';

const PERSPECTIVES = { LEDGER: 'LEDGER', MINE: 'MINE' } as const;

/** 統計查詢的輸入邊界；曆日存在與跨欄位期間限制由 service 使用共同期間函式驗證。 */
export class GetLedgerStatisticsDto implements GetLedgerStatisticsQuery {
  @ApiProperty({ example: '2026-10-01', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from!: string;

  @ApiProperty({ example: '2026-10-31', pattern: '^\\d{4}-\\d{2}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to!: string;

  @ApiPropertyOptional({ enum: PERSPECTIVES, default: 'LEDGER' })
  @IsEnum(PERSPECTIVES)
  perspective: StatisticsPerspective = 'LEDGER';
}

/** 趨勢使用完整曆月；只轉換數量欄位，避免接受小數或非數字。 */
export class GetStatisticsTrendDto implements GetStatisticsTrendQuery {
  @ApiProperty({ example: '2026-10', pattern: '^\\d{4}-\\d{2}$' })
  @Matches(/^\d{4}-\d{2}$/)
  endMonth!: string;

  @ApiPropertyOptional({ type: Number, minimum: 1, maximum: 24, default: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  months = 12;

  @ApiPropertyOptional({ enum: PERSPECTIVES, default: 'LEDGER' })
  @IsEnum(PERSPECTIVES)
  perspective: StatisticsPerspective = 'LEDGER';
}
