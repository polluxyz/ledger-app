import { DEFAULT_HOME_LAYOUT_V1, ErrorCode } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HomeLayoutService } from './home-layout.service';

/** 用 Prisma mock 驗證原子條件、寫入快照與安全整數轉換，避免先讀再寫或寫後重讀的競態。 */
describe('HomeLayoutService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const service = new HomeLayoutService({
    userHomeLayout: { findUnique, create, update },
  } as unknown as PrismaService);
  const dto = {
    schemaVersion: 1 as const,
    expectedRevision: 2,
    layout: { ...DEFAULT_HOME_LAYOUT_V1 },
  };
  const row = { schemaVersion: 1, revision: 3n, layout: DEFAULT_HOME_LAYOUT_V1 };
  const select = { schemaVersion: true, revision: true, layout: true };
  const prismaError = (code: string) =>
    new Prisma.PrismaClientKnownRequestError('database error', { code, clientVersion: '7' });

  beforeEach(() => {
    jest.resetAllMocks();
    // 讓額外 GET 的內容不同，確定 PUT 採用的是寫入時回傳的快照。
    findUnique.mockResolvedValue({ ...row, revision: 99n, layout: null });
    update.mockResolvedValue(row);
    create.mockResolvedValue({ ...row, revision: 1n });
  });

  it('沒有資料時回預設狀態且不建立資料列', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.get('alice')).resolves.toEqual({
      schemaVersion: 1,
      revision: 0,
      layout: null,
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { userId_surface: { userId: 'alice', surface: 'WEB' } },
      select,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([1, 2, 2147483646, 2147483647, 9007199254740990])(
    'revision %i 條件遞增並直接回傳更新快照',
    async (expectedRevision) => {
      update.mockResolvedValue({ ...row, revision: BigInt(expectedRevision) + 1n });
      await expect(service.put('alice', { ...dto, expectedRevision })).resolves.toEqual({
        ...row,
        revision: expectedRevision + 1,
      });
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        where: {
          userId_surface: { userId: 'alice', surface: 'WEB' },
          revision: BigInt(expectedRevision),
        },
        data: { schemaVersion: 1, layout: dto.layout, revision: { increment: 1 } },
        select,
      });
      expect(findUnique).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('更新找不到主鍵或 revision 不符的 P2025 回 409', async () => {
    update.mockRejectedValue(prismaError('P2025'));
    await expect(service.put('alice', dto)).rejects.toMatchObject({
      status: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('revision 0 直接建立第一版並回傳建立快照', async () => {
    await expect(service.put('alice', { ...dto, expectedRevision: 0 })).resolves.toEqual({
      ...row,
      revision: 1,
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'alice', surface: 'WEB', revision: 1, schemaVersion: 1, layout: dto.layout },
      select,
    });
    expect(update).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('建立只有 P2002 轉成版面衝突', async () => {
    create.mockRejectedValue(prismaError('P2002'));
    await expect(service.put('alice', { ...dto, expectedRevision: 0 })).rejects.toMatchObject({
      status: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each([
    [0, 'P2003'],
    [0, 'P2024'],
    [0, 'P2025'],
    [2, 'P2002'],
    [2, 'P2003'],
    [2, 'P2024'],
  ])('revision %i 的其他 Prisma 錯誤 %s 原樣拋出', async (expectedRevision, code) => {
    const error = prismaError(code);
    (expectedRevision === 0 ? create : update).mockRejectedValue(error);
    await expect(service.put('alice', { ...dto, expectedRevision })).rejects.toBe(error);
  });

  it.each([0, 2])('revision %i 的一般錯誤原樣拋出', async (expectedRevision) => {
    const error = new Error('connection unavailable');
    (expectedRevision === 0 ? create : update).mockRejectedValue(error);
    await expect(service.put('alice', { ...dto, expectedRevision })).rejects.toBe(error);
  });

  it.each([0, 2, 2147483647])(
    '重設 revision %i 使用資料庫 NULL 並持續遞增',
    async (expectedRevision) => {
      const mutation = expectedRevision === 0 ? create : update;
      mutation.mockResolvedValue({ ...row, revision: BigInt(expectedRevision) + 1n, layout: null });
      await expect(
        service.put('alice', { ...dto, expectedRevision, layout: null }),
      ).resolves.toEqual({ schemaVersion: 1, revision: expectedRevision + 1, layout: null });
      expect(mutation).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            layout: Prisma.DbNull,
            revision: expectedRevision === 0 ? 1 : { increment: 1 },
          }) as unknown,
        }),
      );
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it.each([0n, 9007199254740991n])('GET 精確轉換 revision %s 為 number', async (revision) => {
    findUnique.mockResolvedValue({ ...row, revision });
    const response = await service.get('alice');
    expect(response).toEqual({ ...row, revision: Number(revision) });
    expect(typeof response.revision).toBe('number');
  });

  it.each([-1n, 9007199254740992n])(
    'GET 與兩種 PUT 拒絕超出安全範圍的 revision %s',
    async (revision) => {
      const invalid = { ...row, revision };
      findUnique.mockResolvedValue(invalid);
      create.mockResolvedValue(invalid);
      update.mockResolvedValue(invalid);
      await expect(service.get('alice')).rejects.toThrow(Error);
      await expect(service.put('alice', dto)).rejects.toThrow(Error);
      await expect(service.put('alice', { ...dto, expectedRevision: 0 })).rejects.toThrow(Error);
    },
  );

  it('不合格版面回固定 400，不寫資料也不暴露 reason', async () => {
    await expect(service.put('alice', { ...dto, layout: { bands: [] } })).rejects.toMatchObject({
      status: 400,
      message: '版面格式不正確',
    });
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
