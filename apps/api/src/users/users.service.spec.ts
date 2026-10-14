import { HttpStatus } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService.getRecordDefaults', () => {
  const userId = 'mine';
  const ledgerId = 'ledger-a';
  const accountId = 'account-a';
  const findFirst = jest.fn<Promise<unknown>, [{ where: Record<string, unknown> }]>();
  const findMembership = jest.fn();
  const service = new UsersService({
    transaction: { findFirst },
    ledgerMember: { findUnique: findMembership },
  } as unknown as PrismaService);

  const recent = (
    role: 'OWNER' | 'EDITOR' | 'VIEWER' | null = 'OWNER',
    archivedAt: Date | null = null,
  ) => ({
    ledgerId,
    accountId,
    ledger: { archivedAt, members: role ? [{ role }] : [] },
  });

  beforeEach(() => {
    findFirst.mockReset();
    findMembership.mockReset();
  });

  it('沒有交易時兩個欄位都是 null', async () => {
    findFirst.mockResolvedValue(null);
    await expect(service.getRecordDefaults(userId)).resolves.toEqual({
      ledgerId: null,
      accountId: null,
    });
  });

  it('只查本人建立、未刪除且帳戶屬本人、非臨時帳戶的最新交易', async () => {
    findFirst.mockResolvedValue(recent());
    await expect(service.getRecordDefaults(userId)).resolves.toEqual({ ledgerId, accountId });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          creatorId: userId,
          deletedAt: null,
          accountId: { not: null },
          account: { is: { userId, isTemporary: false } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it.each(['OWNER', 'EDITOR'] as const)('%s 可寫入的未封存帳本會帶入', async (role) => {
    findFirst.mockResolvedValue(recent(role));
    await expect(service.getRecordDefaults(userId)).resolves.toEqual({ ledgerId, accountId });
  });

  it.each([
    ['VIEWER', recent('VIEWER')],
    ['封存', recent('OWNER', new Date())],
    ['退出', recent(null)],
  ])('%s 的最近交易只帶入帳戶', async (_reason, row) => {
    findFirst.mockResolvedValue(row);
    await expect(service.getRecordDefaults(userId)).resolves.toEqual({ ledgerId: null, accountId });
  });

  it('指定未加入或已退出的帳本回 404，且不查交易', async () => {
    findMembership.mockResolvedValue(null);
    await expect(service.getRecordDefaults(userId, ledgerId)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('指定帳本先查同一本最近用的帳戶，並保留原 ledgerId', async () => {
    findMembership.mockResolvedValue({ userId });
    findFirst.mockResolvedValue(recent('VIEWER', new Date()));
    await expect(service.getRecordDefaults(userId, ledgerId)).resolves.toEqual({
      ledgerId,
      accountId,
    });
    expect(findMembership).toHaveBeenCalledWith({
      where: { ledgerId_userId: { ledgerId, userId } },
      select: { userId: true },
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
    const scopedArgs: unknown = findFirst.mock.calls[0]?.[0];
    expect(scopedArgs).toMatchObject({ where: { ledgerId } });
  });

  it('指定帳本沒用過時，回退整體最近帳戶', async () => {
    findMembership.mockResolvedValue({ userId });
    findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(recent());
    await expect(service.getRecordDefaults(userId, 'ledger-b')).resolves.toEqual({
      ledgerId: 'ledger-b',
      accountId,
    });
    expect(findFirst).toHaveBeenCalledTimes(2);
    const fallbackArgs = findFirst.mock.calls[1]?.[0] as { where: Record<string, unknown> };
    expect(fallbackArgs.where).not.toHaveProperty('ledgerId');
  });

  it('指定帳本也沒有整體歷史時，只回固定的 ledgerId', async () => {
    findMembership.mockResolvedValue({ userId });
    findFirst.mockResolvedValue(null);
    await expect(service.getRecordDefaults(userId, ledgerId)).resolves.toEqual({
      ledgerId,
      accountId: null,
    });
  });
});
