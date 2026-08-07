import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { RegisterRequest } from '@ledger/shared';

export class RegisterDto implements RegisterRequest {
  @ApiProperty({ example: 'alice@example.com', format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sup3rsecret', minLength: 8, maxLength: 72 })
  @IsString()
  // bcrypt only hashes the first 72 bytes; cap length so longer input is not
  // silently truncated into an equivalent password.
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @ApiProperty({ example: 'Alice' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
