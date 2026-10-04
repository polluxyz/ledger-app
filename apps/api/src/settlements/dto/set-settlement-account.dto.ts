import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { SetAccountRequest } from '@ledger/shared';

/** VIEWER 補自己的結清帳戶時唯一可送入的欄位。 */
export class SetSettlementAccountDto implements SetAccountRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;
}
