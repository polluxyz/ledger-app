import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LedgerRole } from '@ledger/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerAccessGuard } from './ledger-access.guard';

function contextFor(ledgerId: string | undefined): ExecutionContext {
  const request = { user: { sub: 'user-1', email: 'a@b.c' }, params: { ledgerId } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/**
 * LedgerAccessGuard 的單元測試。核心是那張「角色門檻矩陣」（用 it.each 逐格驗證），
 * 外加：無 @RequireLedgerRole 的路由直接放行、非成員回 404（不洩漏存在）、
 * 缺 :ledgerId 參數視為設定錯誤回 404。
 */
describe('LedgerAccessGuard', () => {
  let guard: LedgerAccessGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let prisma: { ledgerMember: { findUnique: jest.Mock } };

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    prisma = { ledgerMember: { findUnique: jest.fn() } };
    guard = new LedgerAccessGuard(
      reflector as unknown as Reflector,
      prisma as unknown as PrismaService,
    );
  });

  it('passes through routes without a required role (not ledger-scoped)', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(contextFor('ledger-1'))).resolves.toBe(true);
    expect(prisma.ledgerMember.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 for a non-member (does not reveal existence)', async () => {
    reflector.getAllAndOverride.mockReturnValue('VIEWER');
    prisma.ledgerMember.findUnique.mockResolvedValue(null);

    await expect(guard.canActivate(contextFor('ledger-1'))).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
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
      reflector.getAllAndOverride.mockReturnValue(required);
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
    reflector.getAllAndOverride.mockReturnValue('VIEWER');

    await expect(guard.canActivate(contextFor(undefined))).rejects.toMatchObject({
      constructor: AppException,
      errorCode: 'NOT_FOUND',
    });
  });
});
