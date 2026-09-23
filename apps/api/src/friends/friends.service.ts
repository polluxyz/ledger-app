/* eslint-disable @typescript-eslint/no-unused-vars -- 骨架：實作時連同這一行一起移除 */
import { Injectable, NotImplementedException } from '@nestjs/common';
import type { Friend, Paginated } from '@ledger/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 好友清單與解除好友。規格見 `docs/specs/phase-3a-friends.md` §2 決策 10、12、§5。
 *
 * TODO(T6)：由 worker 實作。方法簽章與回應形狀是 API 契約，不要改。
 */
@Injectable()
export class FriendsService {
  constructor(private readonly prisma: PrismaService) {}

  list(_userId: string, _query: { page?: number; limit?: number }): Promise<Paginated<Friend>> {
    throw new NotImplementedException();
  }

  remove(_userId: string, _friendUserId: string): Promise<void> {
    throw new NotImplementedException();
  }
}
