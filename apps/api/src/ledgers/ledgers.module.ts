import { Module } from '@nestjs/common';
import { LedgersController } from './ledgers.controller';
import { LedgersService } from './ledgers.service';
import { LedgerAccessGuard } from './guards/ledger-access.guard';

/**
 * Owns ledger CRUD and the ledger authorization guard. LedgersService is
 * exported so other modules (e.g. AuthModule at registration) can seed a
 * personal ledger.
 */
@Module({
  controllers: [LedgersController],
  providers: [LedgersService, LedgerAccessGuard],
  exports: [LedgersService],
})
export class LedgersModule {}
