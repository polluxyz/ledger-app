import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateUserRequest } from '@ledger/shared';
import { TrimName } from '../../common/decorators/trim-name.decorator';

/** 更新個人資料的請求形狀；目前僅開放改 name。 */
export class UpdateUserDto implements UpdateUserRequest {
  @ApiProperty({
    example: 'Alice',
    description: '去掉前後空白後驗證。',
    minLength: 1,
    maxLength: 100,
  })
  @TrimName()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
