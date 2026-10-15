import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CREATE_DEBT_ENTRY_KINDS, MAX_AMOUNT_CENTS } from '@ledger/shared';
import type { CreateDebtEntryKind, CreateDebtEntryRequest } from '@ledger/shared';
import { DebtEntryRecordTargetDto } from './debt-entry-record-target.dto';

/**
 * 往來對象：既有的用 `id`，新的用 `name`。兩個都給或都不給，由 service 回 400——
 * class-validator 表達不了「二選一」，這裡只驗各自的格式。
 *
 * `name` 在這一層就去掉前後空白（決策 33），之後的長度檢查與比對都用去掉後的值。
 */
export class DebtEntryCounterpartyDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name?: string;
}

/**
 * `POST /debt-entries` 的 body。
 *
 * 種類與 `settle` 的組合由 `assertEntryShape` 檢查；分類方向要先解析還款方向，
 * 交給 `TransactionsService.assertDebtCategory`。這裡只驗格式。
 */
export class CreateDebtEntryDto implements Omit<CreateDebtEntryRequest, 'counterparty'> {
  @ApiProperty({ type: DebtEntryCounterpartyDto })
  @ValidateNested()
  @Type(() => DebtEntryCounterpartyDto)
  counterparty!: DebtEntryCounterpartyDto;

  @ApiProperty({
    enum: CREATE_DEBT_ENTRY_KINDS,
    description: 'REPAYMENT is stored as COLLECT or REPAY depending on the current balance.',
  })
  @IsIn(CREATE_DEBT_ENTRY_KINDS)
  kind!: CreateDebtEntryKind;

  @ApiProperty({
    description: '正整數金額；單位：分（0.01 元）。',
    example: 100000,
    minimum: 1,
    maximum: MAX_AMOUNT_CENTS,
  })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amount!: number;

  @ApiProperty({ example: '2026-09-24T12:00:00.000Z', format: 'date-time' })
  @IsISO8601()
  date!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  /**
   * 必填物件（3h 決策 163）：沒有「不記入帳本」。`null` 與省略都過不了 `@IsDefined` 與
   * `@ValidateNested`，回 400。
   */
  @ApiProperty({ type: DebtEntryRecordTargetDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => DebtEntryRecordTargetDto)
  record!: DebtEntryRecordTargetDto;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      '選填；同帳本分類。借出、還款用支出分類，借入、收回用收入分類；只是標記，不改變交易型別。',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Settle the balance to zero with this repayment. REPAYMENT only.',
  })
  @IsOptional()
  @IsBoolean()
  settle?: boolean;
}
