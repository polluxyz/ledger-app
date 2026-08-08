import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { LEDGER_ROLES } from '@ledger/shared';
import type { AddMemberRequest, LedgerRole } from '@ledger/shared';

export class AddMemberDto implements AddMemberRequest {
  @ApiProperty({ example: 'bob@example.com', format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: LEDGER_ROLES, example: 'EDITOR' })
  @IsIn(LEDGER_ROLES)
  role!: LedgerRole;
}
