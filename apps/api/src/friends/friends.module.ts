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
 * （SEC-19），也不碰 `LedgerAccessGuard`。
 *
 * 匯出邀請與邀請連結的 service，給往來帳的「邀請連動」端點用（3b-2 決策 56）：連動邀請就是
 * 帶著對象的同一種邀請，不另寫一份。相依只有單向（`DebtsModule` → `FriendsModule`）。
 */
@Module({
  controllers: [FriendRequestsController, FriendInviteLinksController, FriendsController],
  providers: [
    FriendRequestsService,
    FriendInviteLinksService,
    FriendsService,
    { provide: CLOCK, useValue: systemClock },
  ],
  exports: [FriendRequestsService, FriendInviteLinksService],
})
export class FriendsModule {}
