import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { Env } from '../config/env.validation';
import { PrismaClient } from '../generated/prisma/client';

/**
 * 把產生出來的 Prisma Client 包成可注入的 NestJS provider，並把它的連線生命週期
 * 綁到應用程式的生命週期（啟動時連線、關閉時斷線）。
 *
 * Prisma 7 改用 driver adapter（pg）連線，而非內建引擎，因此連線字串在這裡透過
 * PrismaPg 傳入。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
