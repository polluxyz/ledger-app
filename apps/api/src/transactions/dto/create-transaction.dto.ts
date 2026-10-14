import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MANUAL_TRANSACTION_TYPES, MAX_AMOUNT_CENTS } from '@ledger/shared';
import type { CreateTransactionRequest, ManualTransactionType } from '@ledger/shared';
import { LedgerSplitDto } from './ledger-split.dto';

/**
 * 建立交易時 POST body 的驗證形狀。
 *
 * DTO 就是「信任邊界」：全域 ValidationPipe 會對原始請求跑下面這些
 * class-validator 裝飾器，任何不合法的輸入在進到 controller 之前就先被擋下、
 * 回 400，因此 service 可以放心假設拿到的資料已是合法格式。
 *
 * `implements CreateTransactionRequest` 把這個 class 綁到 `@ledger/shared` 裡的
 * 共用契約型別，讓後端 API 與 Web／Mobile 前端保持一致——一旦這份 DTO 與雙方
 * 講好的請求形狀不符，編譯器就會在這裡報錯。`@ApiProperty` 則供自動產生的
 * Swagger／OpenAPI 文件使用。
 */
export class CreateTransactionDto implements CreateTransactionRequest {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;
  @ApiProperty({ enum: MANUAL_TRANSACTION_TYPES, example: 'EXPENSE' })
  @IsIn(MANUAL_TRANSACTION_TYPES)
  type!: ManualTransactionType;

  // 金額以分（0.01 元）表示；12000 分就是 120 元。維持整數以避免精度誤差。
  @ApiProperty({
    description: '正整數金額；單位：分（0.01 元）。',
    example: 12000,
    minimum: 1,
    maximum: MAX_AMOUNT_CENTS,
  })
  @IsInt()
  @IsPositive()
  @Max(MAX_AMOUNT_CENTS)
  amount!: number;

  @ApiProperty({ example: '2026-08-08T12:00:00.000Z', format: 'date-time' })
  @IsISO8601()
  date!: string;

  // 以下三個欄位在型別上都是選填，但實際上依交易型別與付款人決定必填與否。
  // 這種跨欄位規則交給 TransactionsService 驗證並回 400。
  //
  // | 型別       | categoryId | accountId       | toAccountId |
  // | ---------- | ---------- | --------------- | ----------- |
  // | 支出／收入 | 必填       | 本人付時必填    | 不可填      |
  // | 轉帳       | 不可填     | 必填            | 必填        |
  @ApiPropertyOptional({ format: 'uuid', description: 'Required unless the type is TRANSFER.' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: "Required when the ledger tracks balances. Must be the caller's own account.",
  })
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Required for TRANSFER only.' })
  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @ApiProperty({ required: false, example: 'Lunch with team', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  payerPersonId?: string;

  @ApiPropertyOptional({ type: LedgerSplitDto, nullable: true })
  @ValidateIf((_, value: unknown) => value !== null && value !== undefined)
  @ValidateNested()
  @Type(() => LedgerSplitDto)
  ledgerSplit?: LedgerSplitDto | null;
}
