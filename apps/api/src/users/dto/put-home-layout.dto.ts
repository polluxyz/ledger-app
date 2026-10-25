import { ApiProperty } from '@nestjs/swagger';
import { Equals, IsInt, IsObject, Min, ValidateIf } from 'class-validator';

/** 只驗證請求外殼；版面保留原始樹交給共用解析器，避免巢狀白名單刪掉節點欄位。 */
export class PutHomeLayoutDto {
  @ApiProperty({ type: Number, enum: [1], description: '版面 JSON 格式版本。' })
  @Equals(1)
  schemaVersion!: 1;

  @ApiProperty({
    type: 'integer',
    minimum: 0,
    description: '編輯開始時的 revision；初次儲存為 0。',
  })
  @IsInt()
  @Min(0)
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
