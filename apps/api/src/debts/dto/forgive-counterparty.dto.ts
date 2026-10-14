import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { ForgiveCounterpartyRequest } from '@ledger/shared';

/** 免除要由使用者選帳本，才知道呆帳要記在哪裡。 */
export class ForgiveCounterpartyDto implements ForgiveCounterpartyRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  ledgerId!: string;
}
