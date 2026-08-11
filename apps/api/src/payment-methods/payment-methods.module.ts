import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { PaymentMethodsController } from './payment-methods.controller';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * 匯入 LedgersModule，以便在帳本範圍的路由上重用 LedgerAccessGuard。
 */
@Module({
  imports: [LedgersModule],
  controllers: [PaymentMethodsController],
  providers: [PaymentMethodsService],
})
export class PaymentMethodsModule {}
