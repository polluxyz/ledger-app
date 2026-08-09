import { ApiProperty } from '@nestjs/swagger';
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

  // 金額以貨幣最小單位表示的正整數（例如 120＝1.20 TWD）。絕不用浮點數——
  // 整數可避免金額運算的精度誤差。
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

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiProperty({ required: false, example: 'Lunch with team', maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
