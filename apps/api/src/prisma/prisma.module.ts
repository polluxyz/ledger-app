import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * 標為 @Global，讓每個功能模組都能直接注入 PrismaService，不必逐一 import
 * PrismaModule。
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
