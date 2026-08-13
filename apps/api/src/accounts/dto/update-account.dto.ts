import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateAccountRequest } from '@ledger/shared';

/**
 * 更新帳戶的請求形狀。兩個欄位都可單獨送出。
 *
 * 改 `initialBalance` 會讓餘額整體平移，這正是「一開始填錯、事後校正」時要的行為；
 * 改名不影響歷史交易，因為交易存的是 id 而非名稱快照。
 */
export class UpdateAccountDto implements UpdateAccountRequest {
  @ApiPropertyOptional({ example: '台灣銀行', minLength: 1, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name?: string;

  /** 可為負（信用卡既有欠款）；理由同 CreateAccountDto。 */
  @ApiPropertyOptional({ example: -12000 })
  @IsOptional()
  @IsInt()
  initialBalance?: number;
}
