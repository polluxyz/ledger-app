import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { DebtPaymentsController } from './debt-payments.controller';
import { DebtPaymentsService } from './debt-payments.service';
import { DebtsController } from './debts.controller';
import { DebtsService } from './debts.service';

/**
 * 借還帳（階段三 3b-1：單邊借還）。
 *
 * 借還交易的寫入規則（帳戶規則、唯讀）只在 `TransactionsService` 一份，這裡匯入它來用，
 * 不自己寫交易。
 */
@Module({
  imports: [TransactionsModule],
  controllers: [DebtsController, DebtPaymentsController],
  providers: [DebtsService, DebtPaymentsService],
})
export class DebtsModule {}
