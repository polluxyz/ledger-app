import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { CreateDebtPaymentRequest } from '@ledger/shared';
import { DebtRecordTargetDto } from './debt-record-target.dto';

/**
 * `POST /debts/{id}/payments` 的 body。
 *
 * 交易型別不能指定：我借出的債務收到還款一律 `COLLECT`，我借入的債務還錢一律 `REPAY`
 * （spec 決策 3）。「不得超過未清餘額」要查資料庫，由 service 把關。
 */
export class CreateDebtPaymentDto implements CreateDebtPaymentRequest {
  @ApiProperty({
    description: "Amount in the currency's minor unit; positive integer.",
    example: 1000,
  })
  @IsInt()
  @IsPositive()
  amount!: number;

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
    description:
      "Omit to reuse the principal transaction's ledger and account; if the principal has no transaction, no transaction is created.",
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => DebtRecordTargetDto)
  record?: DebtRecordTargetDto;
}
