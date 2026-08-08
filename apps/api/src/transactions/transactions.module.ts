import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * Imports LedgersModule to reuse LedgerAccessGuard for its ledger-scoped
 * routes.
 */
@Module({
  imports: [LedgersModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
