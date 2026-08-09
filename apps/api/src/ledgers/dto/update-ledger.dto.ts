import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdateLedgerRequest } from '@ledger/shared';

/** 帳本改名的請求形狀。 */
export class UpdateLedgerDto implements UpdateLedgerRequest {
  @ApiProperty({ example: '重新命名的帳本', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
