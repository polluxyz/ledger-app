import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsIn, IsOptional, IsUUID, Min } from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { ListTransactionsQuery, TransactionType } from '@ledger/shared';

export class ListTransactionsQueryDto implements ListTransactionsQuery {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: TRANSACTION_TYPES })
  @IsOptional()
  @IsIn(TRANSACTION_TYPES)
  type?: TransactionType;
}
