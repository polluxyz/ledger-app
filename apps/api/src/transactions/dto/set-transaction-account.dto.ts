/** 只有付款人可補自己帳戶的專用請求。 */
import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { SetAccountRequest } from '@ledger/shared';

export class SetTransactionAccountDto implements SetAccountRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  accountId!: string;
}
