import { forwardRef, Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';

/**
 * 匯入 LedgersModule，以便在帳本範圍的路由上重用 LedgerAccessGuard。
 */
@Module({
  imports: [forwardRef(() => LedgersModule)],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
