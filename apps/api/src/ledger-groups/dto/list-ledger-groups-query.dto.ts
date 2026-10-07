import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { ListLedgerGroupsQuery } from '@ledger/shared';

/** 查詢參數必須是明確布林字串，避免任意文字被當成 true。 */
export class ListLedgerGroupsQueryDto implements ListLedgerGroupsQuery {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unpointed?: boolean;
}
