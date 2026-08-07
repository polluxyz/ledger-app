import { SetMetadata } from '@nestjs/common';
import { LedgerRole } from '@ledger/shared';

export const REQUIRE_LEDGER_ROLE_KEY = 'requireLedgerRole';

/**
 * Declares the minimum ledger role required to call a route. LedgerAccessGuard
 * reads this; routes without it are not ledger-scoped and skip the check.
 */
export const RequireLedgerRole = (role: LedgerRole) => SetMetadata(REQUIRE_LEDGER_ROLE_KEY, role);
