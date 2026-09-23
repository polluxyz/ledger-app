import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEBT_STATUSES } from '@ledger/shared';
import type { DebtStatus, ListDebtsQuery } from '@ledger/shared';

/** `GET /debts` 的查詢字串。分頁預設與上限由 service 套用。 */
export class ListDebtsQueryDto implements ListDebtsQuery {
  @ApiPropertyOptional({ enum: DEBT_STATUSES })
  @IsOptional()
  @IsIn(DEBT_STATUSES)
  status?: DebtStatus;

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
}
