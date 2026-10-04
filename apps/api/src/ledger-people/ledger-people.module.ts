import { Module } from '@nestjs/common';
import { LedgerPeopleService } from './ledger-people.service';

@Module({
  providers: [LedgerPeopleService],
  exports: [LedgerPeopleService],
})
export class LedgerPeopleModule {}
