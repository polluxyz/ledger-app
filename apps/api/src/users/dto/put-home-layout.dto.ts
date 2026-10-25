import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsObject, Max, Min, ValidateIf } from 'class-validator';

/** 對應 PostgreSQL INTEGER 上限，避免超出範圍的輸入進入 Prisma 後變成伺服器錯誤。 */
const MAX_HOME_LAYOUT_REVISION = 2147483647;

/** 只驗證請求外殼；版面保留原始樹交給共用解析器，避免巢狀白名單刪掉節點欄位。 */
export class PutHomeLayoutDto {
  @ApiProperty({ type: Number, enum: [1], description: '版面 JSON 格式版本。' })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    maximum: MAX_HOME_LAYOUT_REVISION,
    description: '編輯開始時的 revision；初次儲存為 0。',
  })
  @IsInt()
  @Min(0)
  @Max(MAX_HOME_LAYOUT_REVISION)
  expectedRevision!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description: 'HomeLayoutV1 分割樹；null 代表重設。',
  })
  @ValidateIf((_object, value: unknown) => value !== null)
  @IsObject()
  layout!: Record<string, unknown> | null;
}
