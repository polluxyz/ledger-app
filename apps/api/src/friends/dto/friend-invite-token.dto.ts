import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';
import type { FriendInviteTokenRequest } from '@ledger/shared';

/**
 * 邀請連結的 token。放在 body 而不是網址路徑——路徑會進伺服器的存取日誌（spec §3.4）。
 *
 * 格式是 32 bytes 的 base64url，固定 43 個字元。格式不符直接 400，不必查資料庫。
 */
export class FriendInviteTokenDto implements FriendInviteTokenRequest {
  @ApiProperty({ description: 'The token from the invite link (base64url, 43 characters).' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}
