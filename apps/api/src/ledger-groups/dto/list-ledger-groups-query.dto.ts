import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { ListLedgerGroupsQuery } from '@ledger/shared';

/**
 * 查詢參數必須是明確布林字串，避免任意文字被當成 true。
 * `hasSettlements`（3g W161）：只回有我看得到的已記結清的帳本（含已退出的帳本），
 * 每組帶 `settlementCount`；不帶任何參數時回應與現行完全相同。
 */
export class ListLedgerGroupsQueryDto implements ListLedgerGroupsQuery {
  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  unpointed?: boolean;

  @ApiPropertyOptional({ enum: ['true', 'false'] })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  hasSettlements?: boolean;
}
