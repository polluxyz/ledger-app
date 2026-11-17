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
import {
  ApiBearerAuth,
  ApiTags,
  ApiHeader,
  ApiBadRequestResponse,
  ApiConflictResponse,
} from '@nestjs/swagger';
import { IDEMPOTENCY_KEY_HEADER } from '@ledger/shared';
import { IdempotencyKeyHeader } from '../idempotency/idempotency-key-header.decorator';
import { parseIdempotencyKey } from '../idempotency/idempotency.service';
import type { JwtPayload, Split, UpdateSplitResponse } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateSplitDto, UpdateSplitDto } from './dto/split.dto';
import { SplitsService } from './splits.service';

@ApiTags('splits')
@ApiBearerAuth('jwt')
@Controller('splits')
export class SplitsController {
  constructor(private readonly splits: SplitsService) {}
  @Post()
  @ApiHeader({
    name: IDEMPOTENCY_KEY_HEADER,
    required: true,
    schema: { type: 'string', format: 'uuid' },
  })
  @ApiBadRequestResponse({ description: 'IDEMPOTENCY_KEY_INVALID; VALIDATION_FAILED.' })
  @ApiConflictResponse({ description: 'IDEMPOTENCY_KEY_REUSED; IDEMPOTENCY_RESOURCE_DELETED.' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() body: CreateSplitDto,
    @IdempotencyKeyHeader() rawKey: string | string[] | undefined,
  ): Promise<Split> {
    const key = parseIdempotencyKey(rawKey);
    return this.splits.create(user.sub, body, key);
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
