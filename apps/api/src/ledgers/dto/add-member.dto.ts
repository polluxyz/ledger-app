import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn } from 'class-validator';
import { LEDGER_ROLES } from '@ledger/shared';
import type { AddMemberRequest, LedgerRole } from '@ledger/shared';

/**
 * 加入成員的請求形狀：以 email 指名「已註冊」的使用者，並指定其角色。
 * 只認 email、不吃 userId——邀請未註冊者屬未來功能（見 spec §9）。
 */
export class AddMemberDto implements AddMemberRequest {
  @ApiProperty({ example: 'bob@example.com', format: 'email' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: LEDGER_ROLES, example: 'EDITOR' })
  @IsIn(LEDGER_ROLES)
  role!: LedgerRole;
}
