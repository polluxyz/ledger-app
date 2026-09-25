import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * 接受連動邀請時，接受者選自己這邊的對象（3b-2 決策 58）：既有的用 `id`，新建用 `name`。
 * 「二選一」class-validator 表達不了，由 service 的 `assertLinkChoice` 檢查。
 */
export class LinkCounterpartyChoiceDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 100 })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 100)
  name?: string;
}
