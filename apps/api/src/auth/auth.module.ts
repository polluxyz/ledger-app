import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { LedgersModule } from '../ledgers/ledgers.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@Module({
  imports: [
    LedgersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: {
          expiresIn: config.get('JWT_EXPIRES_IN', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    // 以 APP_GUARD 全域註冊：除非標了 @Public()，否則保護每一個路由。
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  // 匯出 JwtModule，讓全域註冊的 guard 也能取得 JwtService。
  exports: [JwtModule],
})
export class AuthModule {}
