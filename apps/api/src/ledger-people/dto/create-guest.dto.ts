import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

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
}
