import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { ListLedgersQuery } from '@ledger/shared';

/** 帳本列表的查詢字串。 */
export class ListLedgersQueryDto implements ListLedgersQuery {
  /**
   * 是否一併列出已封存的帳本（預設 false）。
   *
   * query string 一律是字串，`@IsBoolean()` 會拒絕 `'true'`，所以先轉型再驗證。
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeArchived?: boolean;
}
