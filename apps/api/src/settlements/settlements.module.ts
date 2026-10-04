import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { LedgerPeopleModule } from '../ledger-people/ledger-people.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

@Module({
  imports: [LedgersModule, LedgerPeopleModule, TransactionsModule],
  controllers: [SettlementsController],
  providers: [SettlementsService],
})
export class SettlementsModule {}
