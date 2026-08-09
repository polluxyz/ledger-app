import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateCategoryRequest } from '@ledger/shared';

/** 分類改名的請求形狀（不含 type，型別不可變）。 */
export class UpdateCategoryDto implements UpdateCategoryRequest {
  @ApiProperty({ example: '飲食', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}
