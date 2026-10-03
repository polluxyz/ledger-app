/** 分帳寫入的 HTTP 邊界；跨欄位與資料所有權由 service 在交易內驗證。 */
import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_AMOUNT_CENTS, SPLIT_METHODS, SPLIT_PRECISIONS, SPLIT_TYPES } from '@ledger/shared';
import type { CreateSplitRequest, SplitParticipantInput } from '@ledger/shared';

class SplitPayerDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() counterpartyId!: string;
}

class SplitParticipantDto implements SplitParticipantInput {
  @ApiProperty({ nullable: true, format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsUUID()
  counterpartyId!: string | null;

  @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Max(10000) ratio?: number;
}

export class CreateSplitDto implements CreateSplitRequest {
  @ApiProperty({ enum: SPLIT_TYPES }) @IsIn(SPLIT_TYPES) type!: 'EXPENSE' | 'INCOME';
  @ApiProperty({ format: 'uuid' }) @IsUUID() ledgerId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() categoryId!: string;
  @ApiProperty({ maximum: MAX_AMOUNT_CENTS })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  total!: number;
  @ApiProperty({ format: 'date-time' }) @IsISO8601() date!: string;
  @ApiPropertyOptional({ maxLength: 100 }) @IsOptional() @IsString() @MaxLength(100) title?: string;
  @ApiPropertyOptional({ maxLength: 500 }) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: SplitPayerDto, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null)
  @IsDefined()
  @ValidateNested()
  @Type(() => SplitPayerDto)
  payer!: SplitPayerDto | null;
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() accountId?: string;
  @ApiProperty({ enum: SPLIT_METHODS }) @IsIn(SPLIT_METHODS) method!: 'EQUAL' | 'AMOUNT' | 'RATIO';
  @ApiPropertyOptional({ enum: SPLIT_PRECISIONS })
  @IsOptional()
  @IsIn(SPLIT_PRECISIONS)
  precision?: 'CENT' | 'YUAN';
  @ApiProperty({ type: [SplitParticipantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SplitParticipantDto)
  participants!: SplitParticipantDto[];
  @ApiPropertyOptional({ format: 'uuid' }) @IsOptional() @IsUUID() fromTransactionId?: string;
}

export class UpdateSplitDto extends OmitType(CreateSplitDto, ['fromTransactionId'] as const) {}
