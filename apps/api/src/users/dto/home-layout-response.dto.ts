import { ApiProperty } from '@nestjs/swagger';
import type { HomeLayoutV1 } from '@ledger/shared';

/** revision 為 0 表示尚未儲存；null 版面由前端套用預設值。 */
export class HomeLayoutResponseDto {
  @ApiProperty({ type: Number, enum: [1], description: '版面 JSON 格式版本。' })
  schemaVersion!: number;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description: '目前已儲存的 revision。',
  })
  revision!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'HomeLayoutV1 分割樹；null 代表使用預設版面。',
  })
  layout!: HomeLayoutV1 | null;
}
