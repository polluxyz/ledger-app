import { Module } from '@nestjs/common';
import { FriendsModule } from '../friends/friends.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';
import { DebtEntriesController } from './debt-entries.controller';
import { DebtEntriesService } from './debt-entries.service';
import { DebtProposalsController } from './debt-proposals.controller';
import { DebtProposalsService } from './debt-proposals.service';

/**
 * 借還帳（階段三 3b，往來帳版）：往來對象、往來紀錄，以及 3b-2 的連動與提議。
 *
 * 交易的寫入規則（帳戶規則、分類規則、唯讀）只在 `TransactionsService` 一份，這裡匯入它來用，
 * 不自己寫交易。
 */
@Module({
  imports: [TransactionsModule, FriendsModule],
  controllers: [CounterpartiesController, DebtEntriesController, DebtProposalsController],
  providers: [CounterpartiesService, DebtEntriesService, DebtProposalsService],
})
export class DebtsModule {}
