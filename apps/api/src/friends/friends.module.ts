import { Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock';
import { FriendInviteLinksController } from './friend-invite-links.controller';
import { FriendInviteLinksService } from './friend-invite-links.service';
import { FriendRequestsController } from './friend-requests.controller';
import { FriendRequestsService } from './friend-requests.service';
import { FriendsController } from './friends.controller';
import { FriendsService } from './friends.service';

/**
 * 好友系統（階段三 3a）。好友關係只是社交層，**不改變任何帳本、帳戶、交易的權限**
 * （SEC-19）。本模組不匯出任何東西給其他模組，也不碰 `LedgerAccessGuard`。
 */
@Module({
  controllers: [FriendRequestsController, FriendInviteLinksController, FriendsController],
  providers: [
    FriendRequestsService,
    FriendInviteLinksService,
    FriendsService,
    { provide: CLOCK, useValue: systemClock },
  ],
})
export class FriendsModule {}
