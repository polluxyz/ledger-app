import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import type { MergeCounterpartyRequest } from '@ledger/shared';

/** 合併只接受來源 id；授權與連動狀態由 service 在交易裡檢查。 */
export class MergeCounterpartyDto implements MergeCounterpartyRequest {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceId!: string;
}
