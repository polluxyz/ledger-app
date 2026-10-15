import { ApiProperty } from '@nestjs/swagger';
import type { RecordDefaults } from '@ledger/shared';

/** 後端從最近交易計算出的記帳預設值；沒有可用紀錄時欄位為 null。 */
export class RecordDefaultsResponseDto implements RecordDefaults {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '最近交易的可寫入帳本。',
  })
  ledgerId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: '最近使用的本人正式帳戶。',
  })
  accountId!: string | null;
}
