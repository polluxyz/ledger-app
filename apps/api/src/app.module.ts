import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { LedgersModule } from './ledgers/ledgers.module';
import { CategoriesModule } from './categories/categories.module';
import { TransactionsModule } from './transactions/transactions.module';

/**
 * 根模組：組裝整個應用程式。載入全域設定（環境變數驗證）、全站流量限制、
 * 資料庫（PrismaModule），以及各功能模組（auth／users／ledgers／categories／
 * transactions）。
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    // 全站寬鬆的預設流量限制；auth 端點再用 @Throttle 收緊。
    // 在 NODE_ENV=test（jest）下停用，避免 e2e 密集的 auth 呼叫被限流；
    // 限流本身另以獨立測試驗證。
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    LedgersModule,
    CategoriesModule,
    TransactionsModule,
  ],
  // 以 APP_GUARD 全域套用限流；JWT 認證 guard 則在 AuthModule 內註冊。
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
