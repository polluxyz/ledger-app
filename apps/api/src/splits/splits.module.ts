/** 分帳沿用交易模組的帳戶、分類規則，並在同一個資料庫交易內寫往來。 */
import { Module } from '@nestjs/common';
import { TransactionsModule } from '../transactions/transactions.module';
import { SplitsController } from './splits.controller';
import { SplitsService } from './splits.service';

@Module({
  imports: [TransactionsModule],
  controllers: [SplitsController],
  providers: [SplitsService],
})
export class SplitsModule {}
