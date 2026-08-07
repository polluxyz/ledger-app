import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateUserRequest } from '@ledger/shared';

export class UpdateUserDto implements UpdateUserRequest {
  @ApiProperty({ example: 'Alice', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
