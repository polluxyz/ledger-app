import { SetMetadata } from '@nestjs/common';
import { LedgerRole } from '@ledger/shared';

export const REQUIRE_LEDGER_ROLE_KEY = 'requireLedgerRole';

/**
 * 宣告呼叫某路由所需的「最低帳本角色」。LedgerAccessGuard 會讀取它；沒標的
 * 路由視為與帳本無關，直接跳過檢查。用法：`@RequireLedgerRole('EDITOR')`。
 */
export const RequireLedgerRole = (role: LedgerRole) => SetMetadata(REQUIRE_LEDGER_ROLE_KEY, role);
