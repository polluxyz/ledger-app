import { Module } from '@nestjs/common';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';

/**
 * 帳戶模組。不需要 imports——帳戶不隸屬帳本，因此用不到 LedgerAccessGuard；
 * 認證由全域的 JWT guard 負責，資料庫由全域的 PrismaModule 提供。
 */
@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
})
export class AccountsModule {}
