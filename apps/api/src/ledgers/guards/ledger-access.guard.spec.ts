import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LedgerRole } from '@ledger/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerAccessGuard } from './ledger-access.guard';
import { REQUIRE_LEDGER_ROLE_KEY } from '../../common/decorators/require-ledger-role.decorator';
import { ALLOW_ON_ARCHIVED_KEY } from '../../common/decorators/allow-on-archived.decorator';

function contextFor(ledgerId: string | undefined, method = 'GET'): ExecutionContext {
  const request = { user: { sub: 'user-1', email: 'a@b.c' }, params: { ledgerId }, method };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/**
 * LedgerAccessGuard 的單元測試。核心是那張「角色門檻矩陣」（用 it.each 逐格驗證），
 * 外加：無 @RequireLedgerRole 的路由直接放行、非成員回 404（不洩漏存在）、
 * 缺 :ledgerId 參數視為設定錯誤回 404，以及已封存帳本的唯讀規則。
 */
describe('LedgerAccessGuard', () => {
  let guard: LedgerAccessGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: {
    ledgerMember: { findUnique: jest.Mock };
    ledgerPerson: { findUnique: jest.Mock };
    ledger: { findUnique: jest.Mock };
  };
  let requiredRole: LedgerRole | undefined;
  let allowOnArchived: boolean;

  beforeEach(() => {
    requiredRole = undefined;
    allowOnArchived = false;
    reflector = {
      getAllAndOverride: jest.fn((key: string) => {
        if (key === REQUIRE_LEDGER_ROLE_KEY) return requiredRole;
        if (key === ALLOW_ON_ARCHIVED_KEY) return allowOnArchived;
        return undefined;
      }),
    };
    prisma = {
      ledgerMember: { findUnique: jest.fn() },
      ledgerPerson: { findUnique: jest.fn() },
      // 預設未封存。
      ledger: { findUnique: jest.fn().mockResolvedValue({ archivedAt: null }) },
    };
    guard = new LedgerAccessGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('passes through routes without a required role (not ledger-scoped)', async () => {
    requiredRole = undefined;

    await expect(guard.canActivate(contextFor('ledger-1'))).resolves.toBe(true);
    expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-member (does not reveal existence)', async () => {
    requiredRole = 'VIEWER';
    prisma.ledgerMember.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('ledger-1'))).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
    expect(prisma.ledgerPerson.findUnique).not.toHaveBeenCalled();
  });

  // 角色層級：OWNER(3) > EDITOR(2) > VIEWER(1)。逐格檢查「持有角色 vs 所需角色」。
  const cases: Array<{
    required: LedgerRole;
    has: LedgerRole;
    allowed: boolean;
  }> = [
    { required: 'VIEWER', has: 'VIEWER', allowed: true },
    { required: 'VIEWER', has: 'EDITOR', allowed: true },
    { required: 'VIEWER', has: 'OWNER', allowed: true },
    { required: 'EDITOR', has: 'VIEWER', allowed: false },
    { required: 'EDITOR', has: 'EDITOR', allowed: true },
    { required: 'EDITOR', has: 'OWNER', allowed: true },
    { required: 'OWNER', has: 'VIEWER', allowed: false },
    { required: 'OWNER', has: 'EDITOR', allowed: false },
    { required: 'OWNER', has: 'OWNER', allowed: true },
  ];

  it.each(cases)(
    'role $has vs required $required -> allowed=$allowed',
    async ({ required, has, allowed }) => {
      requiredRole = required;
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: has });

      if (allowed) {
        await expect(guard.canActivate(contextFor('ledger-1'))).resolves.toBe(true);
      } else {
        await expect(guard.canActivate(contextFor('ledger-1'))).rejects.toMatchObject({
          constructor: AppException,
          errorCode: 'FORBIDDEN',
        });
      }
    },
  );

  it('returns 404 when the route has no ledgerId param', async () => {
    requiredRole = 'VIEWER';

    await expect(guard.canActivate(contextFor(undefined))).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
  });

  it('allows a current member to read', async () => {
    requiredRole = 'VIEWER';
    prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
    const context = contextFor('ledger-1');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.ledgerPerson.findUnique).not.toHaveBeenCalled();
  });

  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])(
    'rejects former members on %s without querying their person',
    async (method) => {
      requiredRole = 'VIEWER';
      prisma.ledgerMember.findUnique.mockResolvedValue(null);
      prisma.ledgerPerson.findUnique.mockResolvedValue({ id: 'former-person' });
      await expect(guard.canActivate(contextFor('ledger-1', method))).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
      expect(prisma.ledgerPerson.findUnique).not.toHaveBeenCalled();
    },
  );

  describe('archived ledgers are read-only', () => {
    beforeEach(() => {
      requiredRole = 'EDITOR';
      prisma.ledgerMember.findUnique.mockResolvedValue({ role: 'EDITOR' });
      prisma.ledger.findUnique.mockResolvedValue({
        archivedAt: new Date('2026-08-13T00:00:00.000Z'),
      });
    });

    it.each(['POST', 'PATCH', 'DELETE'])('409s on %s', async (method) => {
      await expect(guard.canActivate(contextFor('ledger-1', method))).rejects.toMatchObject({
        constructor: AppException,
        errorCode: 'LEDGER_ARCHIVED',
      });
    });

    it('still allows GET (the history must stay readable)', async () => {
      await expect(guard.canActivate(contextFor('ledger-1', 'GET'))).resolves.toBe(true);
      // GET 不必查帳本狀態，省一次查詢。
      expect(prisma.ledger.findUnique).not.toHaveBeenCalled();
    });

    it('does not block writes to a ledger that is not archived', async () => {
      prisma.ledger.findUnique.mockResolvedValue({ archivedAt: null });

      await expect(guard.canActivate(contextFor('ledger-1', 'POST'))).resolves.toBe(true);
    });

    it('allows an explicitly marked archived write', async () => {
      allowOnArchived = true;
      const context = contextFor('ledger-1', 'PUT');
      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(prisma.ledger.findUnique).not.toHaveBeenCalled();
      expect(prisma.ledgerPerson.findUnique).not.toHaveBeenCalled();
    });
  });
});
