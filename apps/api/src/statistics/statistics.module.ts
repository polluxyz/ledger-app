import { Module } from '@nestjs/common';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { StatisticsController } from './statistics.controller';
import { StatisticsService } from './statistics.service';

/** 組裝統計讀取端點，不引入交易寫入或其他領域的業務邏輯。 */
@Module({ controllers: [StatisticsController], providers: [StatisticsService, LedgerAccessGuard] })
export class StatisticsModule {}
