import { Module } from '@nestjs/common';
import { LedgersService } from './ledgers.service';

/**
 * Ledger CRUD endpoints arrive in a later step. For now this module exposes
 * LedgersService so AuthModule can seed a personal ledger at registration
 * time — keeping ledger-creation logic out of AuthService and avoiding a
 * circular dependency.
 */
@Module({
  providers: [LedgersService],
  exports: [LedgersService],
})
export class LedgersModule {}
