import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';

/**
 * 匯入 LedgersModule，以便在帳本範圍的路由上重用 LedgerAccessGuard。
 */
@Module({
  imports: [LedgersModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
})
export class TransactionsModule {}
