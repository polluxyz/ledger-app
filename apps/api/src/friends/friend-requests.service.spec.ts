import { AppException } from '../common/exceptions/app.exception';
import type { PrismaService } from '../prisma/prisma.service';
import { FriendRequestsService } from './friend-requests.service';

/**
 * SC-F6：好友邀請的授權矩陣（spec §3.3）。每一種動作 × 每一種角色 × 邀請狀態，一列一種
 * 組合，漏掉的組合一眼看得出來。
 *
 * ⚠️ 這個檔案由協調者先寫（SEC-10：授權測試先於實作），是 worker 實作 T4 的驗收門檻。
 * **worker 不准修改這個檔案**；覺得它錯了就回報。T4 自己的其他單元測試請另開檔案。
 *
 * 策略：Prisma 全程 mock。為了不綁死實作細節，只約定一件事——**service 用
 * `prisma.friendRequest.findUnique({ where: { id } })` 讀出邀請**（可以帶 `include` /
 * `select`）。其餘寫入方法全部 mock 成成功。
 * - 被拒絕的組合：驗證丟出的 HTTP 狀態與 errorCode，並驗證**沒有任何寫入發生**。
 * - 被允許的組合：只驗證「沒有丟錯」，並且回傳的邀請狀態正確。
 */
describe('FriendRequestsService authorization matrix (SC-F6)', () => {
  const REQUESTER = '11111111-1111-4111-8111-111111111111';
  const RECIPIENT = '22222222-2222-4222-8222-222222222222';
  const STRANGER = '33333333-3333-4333-8333-333333333333';
  const REQUEST_ID = '44444444-4444-4444-8444-444444444444';
  const NOW = new Date('2026-09-23T12:00:00.000Z');

  type Status = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
  type Action = 'accept' | 'decline' | 'cancel';
  type Role = 'requester' | 'recipient' | 'stranger';

  const callerId: Record<Role, string> = {
    requester: REQUESTER,
    recipient: RECIPIENT,
    stranger: STRANGER,
  };

  function requestRow(status: Status) {
    return {
      id: REQUEST_ID,
      requesterId: REQUESTER,
      recipientId: RECIPIENT,
      status,
      respondedAt: status === 'PENDING' ? null : NOW,
      createdAt: new Date('2026-09-20T00:00:00.000Z'),
      updatedAt: NOW,
      requester: { id: REQUESTER, name: 'Alice' },
      recipient: { id: RECIPIENT, name: 'Bob', email: 'bob@example.com' },
    };
  }

  let prisma: ReturnType<typeof buildPrisma>;
  let service: FriendRequestsService;

  function buildPrisma(status: Status) {
    let written: Status = status;
    const mock = {
      friendRequest: {
        findUnique: jest.fn(() => Promise.resolve(requestRow(written))),
        findFirst: jest.fn(() => Promise.resolve(null)),
        findMany: jest.fn(() => Promise.resolve([])),
        count: jest.fn(() => Promise.resolve(0)),
        create: jest.fn(),
        update: jest.fn((args: { data: { status?: Status } }) => {
          written = args.data.status ?? written;
          return Promise.resolve(requestRow(written));
        }),
        updateMany: jest.fn((args: { data: { status?: Status } }) => {
          written = args.data.status ?? written;
          return Promise.resolve({ count: 1 });
        }),
      },
      friendship: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() =>
          Promise.resolve({ userLowId: REQUESTER, userHighId: RECIPIENT, createdAt: NOW }),
        ),
      },
      counterparty: {
        count: jest.fn(() => Promise.resolve(0)),
        create: jest.fn(({ data }: { data: { ownerId: string; askMerge: boolean } }) =>
          Promise.resolve({ id: `cp-${data.ownerId}`, askMerge: data.askMerge }),
        ),
      },
      counterpartyLink: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'link-1' })),
      },
      user: { findUnique: jest.fn(() => Promise.resolve(null)) },
      $transaction: jest.fn((arg: unknown): unknown =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(mock)
          : Promise.all(arg as []),
      ),
    };
    return mock;
  }

  function setup(status: Status) {
    prisma = buildPrisma(status);
    service = new FriendRequestsService(prisma as unknown as PrismaService, () => NOW);
  }

  function expectNoWrites() {
    expect(prisma.friendRequest.update).not.toHaveBeenCalled();
    expect(prisma.friendRequest.updateMany).not.toHaveBeenCalled();
    expect(prisma.friendRequest.create).not.toHaveBeenCalled();
    expect(prisma.friendship.create).not.toHaveBeenCalled();
  }

  async function expectRejected(promise: Promise<unknown>, status: number, errorCode: string) {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).getStatus()).toBe(status);
    expect((error as AppException).errorCode).toBe(errorCode);
  }

  // 非當事人：不論邀請是什麼狀態、做什麼動作，一律 404——不讓外人知道這筆邀請存在。
  describe('a stranger always gets 404', () => {
    const cases: Array<[Action, Status]> = [];
    for (const action of ['accept', 'decline', 'cancel'] as const) {
      for (const status of ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] as const) {
        cases.push([action, status]);
      }
    }

    it.each(cases)(
      '%s on a %s request → 404 NOT_FOUND, nothing written',
      async (action, status) => {
        setup(status);
        await expectRejected(service[action](STRANGER, REQUEST_ID), 404, 'NOT_FOUND');
        expectNoWrites();
      },
    );
  });

  // 找不到這筆邀請：同樣 404，與「不是當事人」無法區分。
  it.each(['accept', 'decline', 'cancel'] as const)(
    '%s on a missing request → 404 NOT_FOUND',
    async (action) => {
      setup('PENDING');
      prisma.friendRequest.findUnique.mockResolvedValue(null as never);
      await expectRejected(service[action](RECIPIENT, REQUEST_ID), 404, 'NOT_FOUND');
      expectNoWrites();
    },
  );

  // 當事人但動作不對：403。角色檢查排在狀態檢查之前，所以即使邀請已結束也是 403。
  describe('the wrong party gets 403', () => {
    const cases: Array<[Action, Role, Status]> = [];
    for (const status of ['PENDING', 'ACCEPTED'] as const) {
      cases.push(['accept', 'requester', status]);
      cases.push(['decline', 'requester', status]);
      cases.push(['cancel', 'recipient', status]);
    }

    it.each(cases)(
      '%s by the %s on a %s request → 403 FORBIDDEN, nothing written',
      async (action, role, status) => {
        setup(status);
        await expectRejected(service[action](callerId[role], REQUEST_ID), 403, 'FORBIDDEN');
        expectNoWrites();
      },
    );
  });

  // 對的當事人、但邀請已結束：409。三個終點狀態都不能再轉換（spec §3.1）。
  describe('the right party on a finished request gets 409', () => {
    const cases: Array<[Action, Role, Status]> = [];
    for (const status of ['ACCEPTED', 'DECLINED', 'CANCELLED'] as const) {
      cases.push(['accept', 'recipient', status]);
      cases.push(['decline', 'recipient', status]);
      cases.push(['cancel', 'requester', status]);
    }

    it.each(cases)(
      '%s by the %s on a %s request → 409 FRIEND_REQUEST_NOT_PENDING, nothing written',
      async (action, role, status) => {
        setup(status);
        await expectRejected(
          service[action](callerId[role], REQUEST_ID),
          409,
          'FRIEND_REQUEST_NOT_PENDING',
        );
        expectNoWrites();
      },
    );
  });

  // 對的當事人、PENDING 的邀請：允許，且回傳的狀態正確。
  describe('the right party on a pending request succeeds', () => {
    const cases: Array<[Action, Role, Status]> = [
      ['decline', 'recipient', 'DECLINED'],
      ['cancel', 'requester', 'CANCELLED'],
    ];

    it.each(cases)('%s by the %s → %s', async (action, role, expected) => {
      setup('PENDING');
      const result = await service[action](callerId[role], REQUEST_ID);
      expect('status' in result ? result.status : undefined).toBe(expected);
      expect('id' in result ? result.id : undefined).toBe(REQUEST_ID);
    });

    it('accept returns the new linked counterparty', async () => {
      setup('PENDING');
      const result = await service.accept(RECIPIENT, REQUEST_ID);
      expect(result).toEqual({
        counterpartyId: `cp-${RECIPIENT}`,
        askMerge: false,
        otherUser: { id: REQUESTER, name: 'Alice' },
      });
    });

    it('only accept creates a friendship', async () => {
      setup('PENDING');
      await service.accept(RECIPIENT, REQUEST_ID);
      expect(prisma.friendship.create).toHaveBeenCalledTimes(1);

      setup('PENDING');
      await service.decline(RECIPIENT, REQUEST_ID);
      expect(prisma.friendship.create).not.toHaveBeenCalled();

      setup('PENDING');
      await service.cancel(REQUESTER, REQUEST_ID);
      expect(prisma.friendship.create).not.toHaveBeenCalled();
    });
  });
});
