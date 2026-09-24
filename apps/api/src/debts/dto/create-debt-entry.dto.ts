import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MANUAL_DEBT_ENTRY_KINDS } from '@ledger/shared';
import type { CreateDebtEntryRequest, ManualDebtEntryKind } from '@ledger/shared';
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
 * 種類與其他欄位的組合規則（`record` 能不能是 null、`categoryId` 與 `settle` 能不能帶）
 * 要看 `kind`，由 service 的 `assertEntryShape` 集中檢查，這裡只驗格式。
 */
export class CreateDebtEntryDto implements Omit<CreateDebtEntryRequest, 'counterparty'> {
  @ApiProperty({ type: DebtEntryCounterpartyDto })
  @ValidateNested()
  @Type(() => DebtEntryCounterpartyDto)
  counterparty!: DebtEntryCounterpartyDto;

  @ApiProperty({ enum: MANUAL_DEBT_ENTRY_KINDS })
  @IsIn(MANUAL_DEBT_ENTRY_KINDS)
  kind!: ManualDebtEntryKind;

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

  /**
   * 必填：物件或 `null`。`@IsOptional` 會把 null 與省略一起放過，所以用 `ValidateIf`
   * 只在有值時驗內容，「省略」由 service 擋下（spec §5.2：不再有「省略就沿用」）。
   */
  @ApiProperty({ type: DebtEntryRecordTargetDto, nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @ValidateNested()
  @Type(() => DebtEntryRecordTargetDto)
  record!: DebtEntryRecordTargetDto | null;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Required for PAID_FOR_ME; an expense category of the ledger.',
  })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    description: 'Settle the balance to zero with this repayment. COLLECT and REPAY only.',
  })
  @IsOptional()
  @IsBoolean()
  settle?: boolean;
}
