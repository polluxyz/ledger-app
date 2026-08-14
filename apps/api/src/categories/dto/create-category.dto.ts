import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { CATEGORY_TYPES } from '@ledger/shared';
import type { CategoryType, CreateCategoryRequest } from '@ledger/shared';

/**
 * 新增分類的請求形狀：名稱＋型別（型別決定它適用於收入或支出）。
 *
 * 型別用的是 `CATEGORY_TYPES` 而非 `TRANSACTION_TYPES`——後者含 `TRANSFER`，
 * 而轉帳沒有分類。用寬的那組會讓 API 接受一個我們明文禁止的東西。
 */
export class CreateCategoryDto implements CreateCategoryRequest {
  @ApiProperty({ example: '餐飲', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ enum: CATEGORY_TYPES, example: 'EXPENSE' })
  @IsIn(CATEGORY_TYPES)
  type!: CategoryType;
}
