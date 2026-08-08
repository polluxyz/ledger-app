import { Module } from '@nestjs/common';
import { LedgersController } from './ledgers.controller';
import { MembersController } from './members.controller';
import { LedgersService } from './ledgers.service';
import { LedgerAccessGuard } from './guards/ledger-access.guard';

/**
 * Owns ledger CRUD, member management, and the ledger authorization guard.
 * LedgersService is exported so other modules (e.g. AuthModule at
 * registration) can seed a personal ledger.
 */
@Module({
  controllers: [LedgersController, MembersController],
  providers: [LedgersService, LedgerAccessGuard],
  // LedgerAccessGuard is exported so ledger-scoped modules (categories,
  // transactions) can reuse the same authorization guard.
  exports: [LedgersService, LedgerAccessGuard],
})
export class LedgersModule {}
