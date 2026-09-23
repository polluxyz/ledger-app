import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import type { LoginRequest } from '@ledger/shared';

/**
 * 登入請求的驗證形狀。密碼這裡只要求「非空字串」（不套註冊時的長度規則）——
 * 正確與否交由 AuthService 比對雜湊決定，DTO 不預先洩漏密碼規則。
 */
export class LoginDto implements LoginRequest {
  @ApiProperty({ example: 'alice@example.com', format: 'email' })
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sup3rsecret' })
  @IsString()
  @MinLength(1)
  password!: string;
}
