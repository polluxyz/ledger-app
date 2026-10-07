import { Module } from '@nestjs/common';
import { LedgerPeopleModule } from '../ledger-people/ledger-people.module';
import { LedgerDebtsService } from './ledger-debts.service';
import { LedgerGroupsController } from './ledger-groups.controller';

/** 結清摘要是讀取共用函式；服務同時供對象總額與帳本群組使用。 */
@Module({
  imports: [LedgerPeopleModule],
  controllers: [LedgerGroupsController],
  providers: [LedgerDebtsService],
  exports: [LedgerDebtsService],
})
export class LedgerGroupsModule {}
