import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { MAX_AMOUNT_CENTS } from '@ledger/shared';
import type { CreateSettlementRequest } from '@ledger/shared';

/**
 * 建立結清的輸入信任邊界。帳戶是否必填、可否由呼叫者選，還取決於帳本與兩位參與者，
 * 因此由 service 套用共用 payer-account 規則。
 */
export class CreateSettlementDto implements CreateSettlementRequest {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  fromPersonId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  toPersonId!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_AMOUNT_CENTS })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amount!: number;

  @ApiProperty({ format: 'date-time' })
  @IsISO8601()
  date!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  fromAccountId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  toAccountId?: string;
}
