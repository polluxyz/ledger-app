import { Module } from '@nestjs/common';
import { IdempotencyService } from './idempotency.service';

/** 各領域匯入同一套防重複送出的交易處理。 */
@Module({ providers: [IdempotencyService], exports: [IdempotencyService] })
export class IdempotencyModule {}
