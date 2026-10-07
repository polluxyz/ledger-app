import { Module } from '@nestjs/common';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { LedgerPeopleController } from './ledger-people.controller';
import { LedgerPeopleService } from './ledger-people.service';
import { LedgerPointersController } from './ledger-pointers.controller';
import { LedgerPointersService } from './ledger-pointers.service';

@Module({
  controllers: [LedgerPeopleController, LedgerPointersController],
  providers: [LedgerPeopleService, LedgerPointersService, LedgerAccessGuard],
  exports: [LedgerPeopleService, LedgerPointersService],
})
export class LedgerPeopleModule {}
