import { Module } from '@nestjs/common';
import { LedgersModule } from '../ledgers/ledgers.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [LedgersModule],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
