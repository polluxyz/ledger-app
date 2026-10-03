/** 分帳路由只傳遞已驗證的 DTO；授權與寫入都由 service 處理。 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, Split, UpdateSplitResponse } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateSplitDto, UpdateSplitDto } from './dto/split.dto';
import { SplitsService } from './splits.service';

@ApiTags('splits')
@ApiBearerAuth('jwt')
@Controller('splits')
export class SplitsController {
  constructor(private readonly splits: SplitsService) {}
  @Post() create(@CurrentUser() user: JwtPayload, @Body() body: CreateSplitDto): Promise<Split> {
    return this.splits.create(user.sub, body);
  }
  @Get(':id') get(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<Split> {
    return this.splits.get(user.sub, id);
  }
  @Patch(':id') update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: UpdateSplitDto,
  ): Promise<UpdateSplitResponse> {
    return this.splits.update(user.sub, id, body);
  }
  @Delete(':id') @HttpCode(HttpStatus.NO_CONTENT) remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<void> {
    return this.splits.remove(user.sub, id);
  }
}
