import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { LEDGER_ROLES } from '@ledger/shared';
import type { UpdateMemberRequest, LedgerRole } from '@ledger/shared';

export class UpdateMemberDto implements UpdateMemberRequest {
  @ApiProperty({ enum: LEDGER_ROLES, example: 'VIEWER' })
  @IsIn(LEDGER_ROLES)
  role!: LedgerRole;
}
