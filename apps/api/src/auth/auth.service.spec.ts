import * as bcrypt from 'bcrypt';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import type { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';
import type { RegisterDto } from './dto/register.dto';

interface CreateArgs {
  data: { email: string; name: string; passwordHash: string };
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
    $transaction: jest.Mock;
  };
  let ledgers: { createLedgerForUser: jest.Mock };
  /** Captured argument passed to user.create, so tests avoid `any` on mock.calls. */
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
      // Default: run the callback with a tx client that mirrors prisma.user.
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb({ user: prisma.user })),
    };
    ledgers = { createLedgerForUser: jest.fn() };
    service = new AuthService(prisma as unknown as PrismaService, ledgers);
  });

  afterEach(() => jest.restoreAllMocks());

  it('hashes the password and provisions a ledger, returning no passwordHash', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.register(dto);

    // Password was hashed (not stored in plaintext).
    expect(createArgs?.data.passwordHash).not.toBe(dto.password);
    await expect(bcrypt.compare(dto.password, createArgs?.data.passwordHash ?? '')).resolves.toBe(
      true,
    );

    // Ledger provisioned inside the same transaction.
    expect(ledgers.createLedgerForUser).toHaveBeenCalledWith(
      expect.anything(),
      dbUser.id,
      expect.stringContaining('Alice'),
    );

    // Response contract carries no sensitive fields.
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

    // The whole register call rejects; because the work is wrapped in
    // $transaction, the user insert is rolled back with it.
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
});
