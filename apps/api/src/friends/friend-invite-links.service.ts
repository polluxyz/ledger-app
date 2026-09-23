/* eslint-disable @typescript-eslint/no-unused-vars -- 骨架：實作時連同這一行一起移除 */
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type { Friend, FriendInviteLinkCreated, FriendInviteLinkPreview } from '@ledger/shared';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 好友邀請連結：產生、預覽、接受。規格見 `docs/specs/phase-3a-friends.md` §2 決策 5～7、
 * §3.2、§3.4、§5。
 *
 * TODO(T5)：由 worker 實作。方法簽章與回應形狀是 API 契約，不要改。
 */
@Injectable()
export class FriendInviteLinksService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  create(_userId: string): Promise<FriendInviteLinkCreated> {
    throw new NotImplementedException();
  }

  preview(_token: string): Promise<FriendInviteLinkPreview> {
    throw new NotImplementedException();
  }

  accept(_userId: string, _token: string): Promise<Friend> {
    throw new NotImplementedException();
  }
}
