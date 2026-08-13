import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
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
  @ApiPropertyOptional({ example: 5000, default: 0 })
  @IsOptional()
  @IsInt()
  initialBalance?: number;
}
