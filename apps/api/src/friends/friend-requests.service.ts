/* eslint-disable @typescript-eslint/no-unused-vars -- 骨架：實作時連同這一行一起移除 */
import { Inject, Injectable, NotImplementedException } from '@nestjs/common';
import type { FriendRequest, ListFriendRequestsQuery, Paginated } from '@ledger/shared';
import { CLOCK } from '../common/clock';
import type { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 以 email 送出的好友邀請：送出、列出、接受、拒絕、取消。規格見
 * `docs/specs/phase-3a-friends.md` §2、§3.1、§3.3、§5。
 *
 * TODO(T4)：由 worker 實作。方法簽章與回應形狀是 API 契約，不要改。
 */
@Injectable()
export class FriendRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly now: Clock,
  ) {}

  create(_userId: string, _email: string): Promise<FriendRequest> {
    throw new NotImplementedException();
  }

  list(_userId: string, _query: ListFriendRequestsQuery): Promise<Paginated<FriendRequest>> {
    throw new NotImplementedException();
  }

  accept(_userId: string, _requestId: string): Promise<FriendRequest> {
    throw new NotImplementedException();
  }

  decline(_userId: string, _requestId: string): Promise<FriendRequest> {
    throw new NotImplementedException();
  }

  cancel(_userId: string, _requestId: string): Promise<FriendRequest> {
    throw new NotImplementedException();
  }
}
