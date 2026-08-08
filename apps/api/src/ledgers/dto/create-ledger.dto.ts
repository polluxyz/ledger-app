import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateLedgerRequest } from '@ledger/shared';

export class CreateLedgerDto implements CreateLedgerRequest {
  @ApiProperty({ example: '家庭帳本', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
