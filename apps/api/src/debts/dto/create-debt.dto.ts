import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { DEBT_DIRECTIONS } from '@ledger/shared';
import type { CreateDebtRequest, DebtDirection } from '@ledger/shared';
import { DebtRecordTargetDto } from './debt-record-target.dto';

/**
 * `POST /debts` 的 body。
 *
 * 沒有「交易型別」欄位可填：借出一律產生 `LEND`、借入一律 `BORROW`（spec 決策 3）。
 * `record` 省略時不產生交易，用於系統上線前就存在的舊債（決策 7）。
 */
export class CreateDebtDto implements CreateDebtRequest {
  @ApiProperty({ enum: DEBT_DIRECTIONS, example: 'LENT' })
  @IsIn(DEBT_DIRECTIONS)
  direction!: DebtDirection;

  @ApiProperty({ example: '小明', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  counterpartyName!: string;

  @ApiProperty({
    description: "Amount in the currency's minor unit; positive integer.",
    example: 5000,
  })
  @IsInt()
  @IsPositive()
  principal!: number;

  @ApiProperty({ example: '2026-09-24T12:00:00.000Z', format: 'date-time' })
  @IsISO8601()
  date!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: DebtRecordTargetDto,
    description: 'Omit to record an old debt without creating a transaction.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DebtRecordTargetDto)
  record?: DebtRecordTargetDto;
}
