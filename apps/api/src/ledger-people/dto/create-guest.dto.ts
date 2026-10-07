import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * 新增非成員的輸入邊界。先去除前後空白再驗證，確保儲存與名稱唯一性都使用同一個值。
 */
export class CreateGuestDto {
  @ApiProperty({ example: '阿美', minLength: 1, maxLength: 50 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '建立虛擬成員時，替呼叫者設定指向的對象。',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  counterpartyId?: string;
}
