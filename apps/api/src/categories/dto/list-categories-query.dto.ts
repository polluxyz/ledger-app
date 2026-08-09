import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { TransactionType } from '@ledger/shared';

/** 分類列表的查詢字串：可選以型別（INCOME／EXPENSE）篩選。 */
export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;
}
