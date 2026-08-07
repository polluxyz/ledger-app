import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, JwtPayload, LedgerRole } from '@ledger/shared';
import { AppException } from '../../common/exceptions/app.exception';
import { REQUIRE_LEDGER_ROLE_KEY } from '../../common/decorators/require-ledger-role.decorator';
import { PrismaService } from '../../prisma/prisma.service';

/** Higher number = more privilege. */
const ROLE_RANK: Record<LedgerRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  OWNER: 3,
};

interface LedgerScopedRequest {
  user: JwtPayload;
  params: { ledgerId?: string };
  ledgerRole?: LedgerRole;
}

/**
 * Enforces ledger membership and role for routes annotated with
 * @RequireLedgerRole(). Runs after the global JwtAuthGuard, so request.user
 * is already set.
 *
 * Security: a non-member gets 404 (not 403) so the API never reveals that a
 * ledger they cannot access exists. Deny by default — routes without the
 * decorator are treated as not ledger-scoped and pass through untouched.
 */
@Injectable()
export class LedgerAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<LedgerRole | undefined>(
      REQUIRE_LEDGER_ROLE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<LedgerScopedRequest>();
    const userId = request.user.sub;
    const ledgerId = request.params.ledgerId;
    if (!ledgerId) {
      // A @RequireLedgerRole route must have a :ledgerId param; misconfiguration.
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    const membership = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });

    // Non-member: 404, not 403 — do not reveal the ledger exists.
    if (!membership) {
      throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
    }

    if (ROLE_RANK[membership.role] < ROLE_RANK[required]) {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have permission to perform this action on this ledger.',
      );
    }

    // Expose the resolved role to downstream handlers if they need it.
    request.ledgerRole = membership.role;
    return true;
  }
}
