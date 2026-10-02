import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_INITIAL_BALANCE_CENTS } from '@ledger/shared';
import type { CreateAccountRequest } from '@ledger/shared';

/** 新增帳戶的請求形狀。 */
export class CreateAccountDto implements CreateAccountRequest {
  @ApiProperty({ example: '國泰世華', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  /**
   * 開始使用本系統時該帳戶已有的金額，省略時為 0。
   *
   * **刻意不加 `@Min(0)`**：信用卡在導入前就有欠款是常態，餘額為負是正確的表達，
   * 不是錯誤輸入。
   */
  @ApiPropertyOptional({
    description: '開始使用本系統時已有的金額；單位：分（0.01 元），可為負。',
    example: 500000,
    default: 0,
    minimum: -MAX_INITIAL_BALANCE_CENTS,
    maximum: MAX_INITIAL_BALANCE_CENTS,
  })
  @IsOptional()
  @IsInt()
  @Min(-MAX_INITIAL_BALANCE_CENTS)
  @Max(MAX_INITIAL_BALANCE_CENTS)
  initialBalance?: number;
}
