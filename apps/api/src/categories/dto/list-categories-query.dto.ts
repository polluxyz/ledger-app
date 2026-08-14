import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CATEGORY_TYPES } from '@ledger/shared';
import type { CategoryType } from '@ledger/shared';

/** 分類列表的查詢字串：可選以型別（INCOME／EXPENSE）篩選。轉帳沒有分類，故不含 TRANSFER。 */
export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ enum: CATEGORY_TYPES })
  @IsOptional()
  @IsIn(CATEGORY_TYPES)
  type?: CategoryType;
}
