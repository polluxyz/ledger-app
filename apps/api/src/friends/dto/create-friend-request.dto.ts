import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';
import type { CreateFriendRequestRequest } from '@ledger/shared';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';

/** 以 email 送出好友邀請。email 先正規化成小寫（見 `NormalizeEmail`）。 */
export class CreateFriendRequestDto implements CreateFriendRequestRequest {
  @ApiProperty({ example: 'bob@example.com', format: 'email' })
  @NormalizeEmail()
  @IsEmail()
  email!: string;
}
