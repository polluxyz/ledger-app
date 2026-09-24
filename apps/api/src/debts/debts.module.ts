import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { CounterpartiesController } from './counterparties.controller';
import { CounterpartiesService } from './counterparties.service';
import { DebtEntriesController } from './debt-entries.controller';
import { DebtEntriesService } from './debt-entries.service';

/**
 * 借還帳（階段三 3b-1，往來帳版）：往來對象與往來紀錄。
 *
 * 交易的寫入規則（帳戶規則、分類規則、唯讀）只在 `TransactionsService` 一份，這裡匯入它來用，
 * 不自己寫交易。
 */
@Module({
  imports: [TransactionsModule],
  controllers: [CounterpartiesController, DebtEntriesController],
  providers: [CounterpartiesService, DebtEntriesService],
})
export class DebtsModule {}
