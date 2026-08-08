import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { CreateTransactionRequest, TransactionType } from '@ledger/shared';

export class CreateTransactionDto implements CreateTransactionRequest {
  @ApiProperty({ enum: TRANSACTION_TYPES, example: 'EXPENSE' })
  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;

  @ApiProperty({
    description: "Amount in the currency's minor unit; positive integer.",
    example: 120,
  })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-08-08T12:00:00.000Z', format: 'date-time' })
  @IsISO8601()
  date!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ required: false, example: 'Lunch with team', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
