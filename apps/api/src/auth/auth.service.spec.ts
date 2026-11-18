import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DEFAULT_ACCOUNTS, TEMPORARY_ACCOUNT_NAME } from '@ledger/shared';
import * as bcrypt from 'bcrypt';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import type { LedgersService } from '../ledgers/ledgers.service';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

interface CreateArgs {
  data: { email: string; name: string; passwordHash: string };
}

/**
 * AuthService 的單元測試。這裡把 Prisma、LedgersService、JwtService 全部 mock 掉
 * （不碰真實資料庫），聚焦在服務本身的邏輯：密碼有雜湊、註冊與建帳本的原子性、
 * 各種失敗如何對應到錯誤碼、登入不做帳號枚舉。
 */
describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    account: { createMany: jest.Mock };
    authSession: {
      create: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let ledgers: { createLedgerForUser: jest.Mock };
  let jwt: { signAsync: jest.Mock };
  /** 攔截傳給 user.create 的參數，讓測試不必對 mock.calls 用 `any`。 */
  let createArgs: CreateArgs | undefined;

  const dto: RegisterDto = {
    email: 'alice@example.com',
    password: 'sup3rsecret',
    name: 'Alice',
  };

  const dbUser = {
    id: 'user-1',
    email: dto.email,
    name: dto.name,
    passwordHash: 'hashed',
    createdAt: new Date('2026-07-21T00:00:00.000Z'),
    updatedAt: new Date('2026-07-21T00:00:00.000Z'),
  };

  beforeEach(() => {
    createArgs = undefined;
    const create = jest.fn((args: CreateArgs) => {
      createArgs = args;
      return Promise.resolve(dbUser);
    });
    prisma = {
      user: { findUnique: jest.fn(), create },
      account: { createMany: jest.fn() },
      authSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
      },
      // 預設：以一個「行為等同 prisma 本身」的 tx client 執行 callback。
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ user: prisma.user, account: prisma.account }),
      ),
    };
    ledgers = { createLedgerForUser: jest.fn() };
    jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    service = new AuthService(
      prisma as unknown as PrismaService,
      ledgers as unknown as LedgersService,
      jwt as unknown as JwtService,
      new ConfigService({ JWT_EXPIRES_IN: '7d' }),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('hashes the password and provisions accounts and a ledger, returning no passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.register(dto);

    // 密碼有經過雜湊（不是明文儲存）。
    expect(createArgs?.data.passwordHash).not.toBe(dto.password);
    await expect(bcrypt.compare(dto.password, createArgs?.data.passwordHash ?? '')).resolves.toBe(
      true,
    );

    // 預設帳戶與帳本都在同一個 transaction 內一併備妥。少了帳戶的話，使用者
    // 一登入就記不了任何一筆帳（連動帳本必須指定帳戶），而且畫面上毫無線索。
    expect(prisma.account.createMany).toHaveBeenCalledWith({
      data: [
        ...DEFAULT_ACCOUNTS.map((name) => ({ userId: dbUser.id, name })),
        // 3h 決策 167：每個使用者剛好一個臨時帳戶，註冊時一起建。
        { userId: dbUser.id, name: TEMPORARY_ACCOUNT_NAME, isTemporary: true },
      ],
    });
    // 註冊自動建立的帳本是私人的——這是「我自己的帳」，不是要共用的。
    expect(ledgers.createLedgerForUser).toHaveBeenCalledWith(expect.anything(), dbUser.id, {
      name: expect.stringContaining('Alice') as string,
      kind: 'PERSONAL',
    });

    // 回應契約不帶任何機敏欄位。
    expect(result).toEqual({
      id: dbUser.id,
      email: dbUser.email,
      name: dbUser.name,
      createdAt: dbUser.createdAt.toISOString(),
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email with a 409 before touching the transaction', async () => {
    prisma.user.findUnique.mockResolvedValue(dbUser);

    await expect(service.register(dto)).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'EMAIL_ALREADY_EXISTS',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('propagates failure (rolls back) when ledger provisioning fails', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    ledgers.createLedgerForUser.mockRejectedValue(new Error('seed failed'));

    // 整個 register 呼叫會 reject；因為工作包在 $transaction 裡，先前的建立
    // 使用者也會一起被回滾。
    await expect(service.register(dto)).rejects.toThrow('seed failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('maps the P2002 unique-violation race to EMAIL_ALREADY_EXISTS', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.register(dto)).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'EMAIL_ALREADY_EXISTS',
    });
  });

  it('rethrows unexpected transaction errors unchanged', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue(new Error('db exploded'));

    await expect(service.register(dto)).rejects.toThrow('db exploded');
  });

  it('applies a bcrypt cost factor that produces a 60-char hash', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await service.register(dto);

    expect(createArgs?.data.passwordHash).toHaveLength(60);
  });

  describe('logout', () => {
    it('revokes only the active session owned by this user when count is 1', async () => {
      prisma.authSession.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.logout('user-1', 'session-1')).resolves.toBeUndefined();
      expect(prisma.authSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'session-1', userId: 'user-1', revokedAt: null },
        data: { revokedAt: expect.any(Date) as Date },
      });
    });

    it('rejects count 0 with 401 UNAUTHORIZED', async () => {
      prisma.authSession.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.logout('user-1', 'session-1')).rejects.toMatchObject({
        errorCode: 'UNAUTHORIZED',
        status: 401,
      });
    });
  });

  describe('login', () => {
    const loginDto: LoginDto = { email: dto.email, password: dto.password };

    it('issues a JWT (sub + email) for valid credentials', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, passwordHash });

      const result = await service.login(loginDto);

      expect(jwt.signAsync).toHaveBeenCalledWith({
        sub: dbUser.id,
        email: dbUser.email,
        sid: 'session-1',
        exp: expect.any(Number) as number,
      });
      expect(prisma.authSession.create).toHaveBeenCalledWith({
        data: { userId: dbUser.id, expiresAt: expect.any(Date) as Date },
      });
      const [created] = prisma.authSession.create.mock.calls[0]! as [{ data: { expiresAt: Date } }];
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ exp: created.data.expiresAt.getTime() / 1000 }),
      );
      expect(prisma.authSession.create.mock.invocationCallOrder[0]).toBeLessThan(
        jwt.signAsync.mock.invocationCallOrder[0]!,
      );
      expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    });

    it('rejects a wrong password with 401 INVALID_CREDENTIALS', async () => {
      const passwordHash = await bcrypt.hash('the-real-password', 10);
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, passwordHash });

      await expect(
        service.login({ ...loginDto, password: 'wrong-password' }),
      ).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'INVALID_CREDENTIALS',
      });
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(prisma.authSession.create).not.toHaveBeenCalled();
      expect(prisma.authSession.findMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown email with the same 401 (no user enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(loginDto)).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'INVALID_CREDENTIALS',
      });
      expect(jwt.signAsync).not.toHaveBeenCalled();
      expect(prisma.authSession.create).not.toHaveBeenCalled();
      expect(prisma.authSession.findMany).not.toHaveBeenCalled();
    });

    it('SC-TV11: returns a token when cleanup fails and logs only the error name', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, passwordHash });
      prisma.authSession.findMany.mockRejectedValue(new TypeError('private token and email'));

      await expect(service.login(loginDto)).resolves.toEqual({ accessToken: 'signed.jwt.token' });
      expect(warn).toHaveBeenCalledWith('TypeError');
    });

    it('deletes at most one selected batch and rechecks expiration without filtering revocation', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, passwordHash });
      prisma.authSession.findMany.mockResolvedValue([{ id: 'expired-1' }, { id: 'expired-2' }]);

      await service.login(loginDto);

      expect(prisma.authSession.findMany).toHaveBeenCalledWith({
        where: { expiresAt: { lt: expect.any(Date) as Date } },
        select: { id: true },
        take: 100,
      });
      const [args] = prisma.authSession.findMany.mock.calls[0]! as [
        { where: { expiresAt: { lt: Date } } },
      ];
      expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['expired-1', 'expired-2'] }, expiresAt: args.where.expiresAt },
      });
    });

    it('does not issue a delete query for an empty batch', async () => {
      const passwordHash = await bcrypt.hash(loginDto.password, 10);
      prisma.user.findUnique.mockResolvedValue({ ...dbUser, passwordHash });
      await service.login(loginDto);
      expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
    });
  });
});
