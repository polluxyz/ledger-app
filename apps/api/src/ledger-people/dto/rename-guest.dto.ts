import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * 非成員改名的輸入邊界。名稱在驗證前先去除前後空白，空白字元本身不能當作名字。
 */
export class RenameGuestDto {
  @ApiProperty({ example: '小美', minLength: 1, maxLength: 50 })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}
