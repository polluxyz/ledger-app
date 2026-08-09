import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { LEDGER_ROLES } from '@ledger/shared';
import type { UpdateMemberRequest, LedgerRole } from '@ledger/shared';

/** 變更成員角色的請求形狀（最後一位 owner 的保護由 service 把關）。 */
export class UpdateMemberDto implements UpdateMemberRequest {
  @ApiProperty({ enum: LEDGER_ROLES, example: 'VIEWER' })
  @IsIn(LEDGER_ROLES)
  role!: LedgerRole;
}
