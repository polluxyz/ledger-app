/** 共享帳本分帳的 HTTP 信任邊界；跨欄位規則仍由 service 驗證。 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_AMOUNT_CENTS, SPLIT_METHODS, SPLIT_PRECISIONS } from '@ledger/shared';
import type {
  LedgerShareInput,
  LedgerSplitInput,
  SplitMethod,
  SplitPrecision,
} from '@ledger/shared';

class LedgerShareDto implements LedgerShareInput {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  personId!: string;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_AMOUNT_CENTS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_AMOUNT_CENTS)
  amount?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 10000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ratio?: number;
}

export class LedgerSplitDto implements LedgerSplitInput {
  @ApiProperty({ enum: SPLIT_METHODS })
  @IsIn(SPLIT_METHODS)
  method!: SplitMethod;

  @ApiPropertyOptional({ enum: SPLIT_PRECISIONS })
  @IsOptional()
  @IsIn(SPLIT_PRECISIONS)
  precision?: SplitPrecision;

  @ApiProperty({ type: [LedgerShareDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => LedgerShareDto)
  shares!: LedgerShareDto[];
}
