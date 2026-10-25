import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { HomeLayoutService } from './home-layout.service';
import { HomeLayoutBodyGuard } from './home-layout-body.guard';

@Module({
  controllers: [UsersController],
  providers: [UsersService, HomeLayoutService, HomeLayoutBodyGuard],
})
export class UsersModule {}
