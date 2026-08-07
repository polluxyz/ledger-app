import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import type { LoginRequest } from '@ledger/shared';

export class LoginDto implements LoginRequest {
  @ApiProperty({ example: 'alice@example.com', format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'sup3rsecret' })
  @IsString()
  @MinLength(1)
  password!: string;
}
