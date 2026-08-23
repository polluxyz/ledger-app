import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LEDGER_KINDS } from '@ledger/shared';
import type { LedgerKind } from '@ledger/shared';

/**
 * 帳本改名的請求形狀。
 *
 * 這個 DTO 刻意**不** `implements UpdateLedgerRequest`：共用契約裡沒有
 * `tracksBalance` 與 `kind`（客戶端本就不該送），但這裡明確接住它們，好回一句
 * 說得出原因的 400。若不宣告，`forbidNonWhitelisted` 也會擋下來，但訊息只會說
 * 「不允許這個屬性」——看的人分不出是自己打錯字，還是這個欄位真的不能改。這樣寫
 * 也讓「建立後不可變更」這條規則出現在自動產生的 OpenAPI 文件上。
 */
export class UpdateLedgerDto {
  @ApiProperty({ example: '重新命名的帳本', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** 送出必得 400 `TRACKS_BALANCE_IMMUTABLE`；僅為了給出清楚的錯誤而存在。 */
  @ApiPropertyOptional({ description: 'Rejected: fixed when the ledger is created.' })
  @IsOptional()
  @IsBoolean()
  tracksBalance?: boolean;

  /** 送出必得 400 `LEDGER_KIND_IMMUTABLE`；僅為了給出清楚的錯誤而存在。 */
  @ApiPropertyOptional({
    enum: LEDGER_KINDS,
    description: 'Rejected: fixed when the ledger is created.',
  })
  @IsOptional()
  @IsIn(LEDGER_KINDS)
  kind?: LedgerKind;
}
