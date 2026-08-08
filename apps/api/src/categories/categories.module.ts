import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * Imports LedgersModule to reuse LedgerAccessGuard for its ledger-scoped
 * routes.
 */
@Module({
  imports: [LedgersModule],
  controllers: [CategoriesController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
