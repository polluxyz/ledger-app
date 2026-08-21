import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateAccountRequest } from '@ledger/shared';

/**
 * 更新帳戶的請求形狀。**只能改名**。
 *
 * `initialBalance` 刻意不列在這裡。它是建立帳戶時記下的歷史事實，一旦開放事後修改，
 * 所有歷史餘額都會跟著平移，而畫面上看不出發生過這件事。
 *
 * 全域 `ValidationPipe` 開了 `forbidNonWhitelisted`（見 `main.ts`），所以帶著
 * `initialBalance` 的請求會被退回 400，而不是被默默丟棄——規則因此真的擋得住，
 * 不只是前端不顯示欄位而已。
 */
export class UpdateAccountDto implements UpdateAccountRequest {
  @ApiPropertyOptional({ example: '台灣銀行', minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;
}
