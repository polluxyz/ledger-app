import { ApiPropertyOptional } from '@nestjs/swagger';
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
import type { UpdateSettlementRequest } from '@ledger/shared';

/**
 * PATCH 只接受要改的欄位。更換任一方時，service 會一併套用該方的帳戶規則。
 */
export class UpdateSettlementDto implements UpdateSettlementRequest {
  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  fromPersonId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsUUID()
  toPersonId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_AMOUNT_CENTS })
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amount?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @ValidateIf((_object, value) => value !== undefined)
  @IsISO8601()
  date?: string;

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
