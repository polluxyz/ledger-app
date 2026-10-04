import { Module } from '@nestjs/common';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { LedgerPeopleController } from './ledger-people.controller';
import { LedgerPeopleService } from './ledger-people.service';

@Module({
  controllers: [LedgerPeopleController],
  providers: [LedgerPeopleService, LedgerAccessGuard],
  exports: [LedgerPeopleService],
})
export class LedgerPeopleModule {}
