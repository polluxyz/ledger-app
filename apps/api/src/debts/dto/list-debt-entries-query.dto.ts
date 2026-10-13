import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEBT_ENTRY_SECTIONS } from '@ledger/shared';
import type { DebtEntrySection, ListDebtEntriesQuery } from '@ledger/shared';

/** `GET /counterparties/{id}/entries` 的查詢參數；不接受對象清單專用的篩選條件。 */
export class ListDebtEntriesQueryDto implements ListDebtEntriesQuery {
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
    enum: DEBT_ENTRY_SECTIONS,
    description: 'Filter entries before pagination; omit to return all entries.',
  })
  @IsOptional()
  @IsIn([...DEBT_ENTRY_SECTIONS])
  section?: DebtEntrySection;
}
