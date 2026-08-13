import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsISO8601,
  IsIn,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { TRANSACTION_TYPES } from '@ledger/shared';
import type { CreateTransactionRequest, TransactionType } from '@ledger/shared';

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
  @ApiProperty({ enum: TRANSACTION_TYPES, example: 'EXPENSE' })
  @IsIn(TRANSACTION_TYPES)
  type!: TransactionType;

  // 金額以帳本幣別的「最小單位」表示的正整數；TWD 的最小單位即為「元」，
  // 故 120 就是 120 元。絕不用浮點數——整數可避免金額運算的精度誤差。
  // （未來支援有輔幣的幣別時，於 packages/shared 加「幣別→小數位數」對照表。）
  @ApiProperty({
    description: "Amount in the currency's minor unit; positive integer.",
    example: 120,
  })
  @IsInt()
  @IsPositive()
  amount!: number;

  @ApiProperty({ example: '2026-08-08T12:00:00.000Z', format: 'date-time' })
  @IsISO8601()
  date!: string;

  // 以下三個欄位在型別上都是選填，但實際上是**條件必填**——該不該填取決於交易
  // 型別與帳本的 tracksBalance。這種「看另一個欄位而定」的規則 class-validator
  // 表達不了（它看不到帳本），因此一律由 TransactionsService 把關並回 400。
  //
  // | 帳本   | 型別       | categoryId | accountId | toAccountId |
  // | ------ | ---------- | ---------- | --------- | ----------- |
  // | 連動   | 支出／收入 | 必填       | 必填      | 不可填      |
  // | 連動   | 轉帳       | 不可填     | 必填      | 必填        |
  // | 非連動 | 支出／收入 | 必填       | 不可填    | 不可填      |
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
}
