import { DEFAULT_HOME_LAYOUT_V1, ErrorCode } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { HomeLayoutService } from './home-layout.service';

/** 用 Prisma mock 驗證原子寫入條件與錯誤映射，避免先讀再寫造成競態。 */
describe('HomeLayoutService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const updateMany = jest.fn();
  const service = new HomeLayoutService({
    userHomeLayout: { findUnique, create, updateMany },
  } as unknown as PrismaService);
  const dto = {
    schemaVersion: 1 as const,
    expectedRevision: 2,
    layout: { ...DEFAULT_HOME_LAYOUT_V1 },
  };
  const row = { schemaVersion: 1, revision: 3, layout: DEFAULT_HOME_LAYOUT_V1 };

  beforeEach(() => {
    jest.resetAllMocks();
    findUnique.mockResolvedValue(row);
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue(row);
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
      select: { schemaVersion: true, revision: true, layout: true },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('先條件更新使用者與 revision，再讀回結果', async () => {
    await expect(service.put('alice', dto)).resolves.toEqual(row);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'alice', surface: 'WEB', revision: 2 },
      data: { schemaVersion: 1, layout: dto.layout, revision: { increment: 1 } },
    });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      findUnique.mock.invocationCallOrder[0]!,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('更新零列回 409，不讀取最新版面', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await expect(service.put('alice', dto)).rejects.toMatchObject({
      status: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('revision 0 直接建立第一版', async () => {
    findUnique.mockResolvedValue({ ...row, revision: 1 });
    await expect(service.put('alice', { ...dto, expectedRevision: 0 })).resolves.toMatchObject({
      revision: 1,
    });
    expect(create).toHaveBeenCalledWith({
      data: { userId: 'alice', surface: 'WEB', revision: 1, schemaVersion: 1, layout: dto.layout },
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('只有 P2002 轉成版面衝突', async () => {
    create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '7' }),
    );
    await expect(service.put('alice', { ...dto, expectedRevision: 0 })).rejects.toMatchObject({
      status: 409,
      errorCode: ErrorCode.HOME_LAYOUT_REVISION_CONFLICT,
    });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it.each(['P2003', 'P2024'])('其他 Prisma 錯誤 %s 原樣拋出', async (code) => {
    const error = new Prisma.PrismaClientKnownRequestError('database error', {
      code,
      clientVersion: '7',
    });
    create.mockRejectedValue(error);
    await expect(service.put('alice', { ...dto, expectedRevision: 0 })).rejects.toBe(error);
  });

  it.each([0, 2])('重設 revision %i 使用資料庫 NULL', async (expectedRevision) => {
    findUnique.mockResolvedValue({ ...row, layout: null });
    await expect(
      service.put('alice', { ...dto, expectedRevision, layout: null }),
    ).resolves.toMatchObject({ layout: null });
    const mutation = expectedRevision === 0 ? create : updateMany;
    expect(mutation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ layout: Prisma.DbNull }) as unknown,
      }),
    );
  });

  it('不合格版面回固定 400，不寫資料也不暴露 reason', async () => {
    await expect(service.put('alice', { ...dto, layout: { bands: [] } })).rejects.toMatchObject({
      status: 400,
      message: '版面格式不正確',
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
