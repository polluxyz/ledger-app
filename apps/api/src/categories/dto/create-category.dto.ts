import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { CreateCategoryRequest, TransactionType } from '@ledger/shared';

export class CreateCategoryDto implements CreateCategoryRequest {
  @ApiProperty({ example: '餐飲', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ enum: TRANSACTION_TYPES, example: 'EXPENSE' })
  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;
}
