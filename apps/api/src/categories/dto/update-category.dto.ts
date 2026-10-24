import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { CATEGORY_ICONS, CATEGORY_NAME_MAX_LENGTH } from '@ledger/shared';
import type { CategoryIcon, UpdateCategoryRequest } from '@ledger/shared';

/** 分類名稱與圖示可各自修改；型別不可變，避免既有交易與分類失配。 */
export class UpdateCategoryDto implements UpdateCategoryRequest {
  @ApiProperty({
    example: '飲食',
    minLength: 1,
    maxLength: CATEGORY_NAME_MAX_LENGTH,
    required: false,
  })
  // 只有未送出才略過；明確送 null 時仍要驗證，避免把 null 寫進不可為空的名稱欄位。
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(1)
  @MaxLength(CATEGORY_NAME_MAX_LENGTH)
  name?: string;

  @ApiProperty({ enum: CATEGORY_ICONS, required: false, nullable: true, example: 'food' })
  @IsOptional()
  @IsIn(CATEGORY_ICONS)
  icon?: CategoryIcon | null;
}
