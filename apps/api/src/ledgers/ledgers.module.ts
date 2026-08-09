import { Module } from '@nestjs/common';
import { LedgersController } from './ledgers.controller';
import { MembersController } from './members.controller';
import { LedgersService } from './ledgers.service';
import { LedgerAccessGuard } from './guards/ledger-access.guard';

/**
 * 統管帳本 CRUD、成員管理，以及帳本授權 guard。匯出 LedgersService，讓其他
 * 模組（例如 AuthModule 在註冊時）能備妥個人帳本。
 */
@Module({
  controllers: [LedgersController, MembersController],
  providers: [LedgersService, LedgerAccessGuard],
  // 匯出 LedgerAccessGuard，讓帳本範圍的模組（categories、transactions）
  // 重用同一個授權 guard。
  exports: [LedgersService, LedgerAccessGuard],
})
export class LedgersModule {}
