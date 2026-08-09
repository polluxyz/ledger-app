import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegisterRequest } from '@ledger/shared';

/** 註冊請求的驗證形狀（email／password／name）。 */
export class RegisterDto implements RegisterRequest {
  @ApiProperty({ example: 'alice@example.com', format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sup3rsecret', minLength: 8, maxLength: 72 })
  @IsString()
  // bcrypt 只雜湊前 72 個位元組；限制長度，避免更長的輸入被默默截斷成等效密碼。
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
