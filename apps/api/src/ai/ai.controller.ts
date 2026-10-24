import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, ParseTransactionResponse } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AiService } from './ai.service';
import { AiUserThrottleGuard } from './ai-user-throttle.guard';
import { ParseTransactionDto } from './dto/parse-transaction.dto';

/** HTTP 邊界只接收 DTO，帳本授權與草稿解析由 service 統一處理。 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('parse-transaction')
  @HttpCode(200)
  @UseGuards(AiUserThrottleGuard)
  @ApiOkResponse({
    description: 'Transaction drafts only; usage is recorded, transactions are not written.',
  })
  @ApiResponse({
    status: 429,
    description:
      'AI_DAILY_LIMIT: personal daily quota exhausted; TOO_MANY_REQUESTS: minute rate limit.',
  })
  @ApiResponse({
    status: 503,
    description:
      'AI_UNAVAILABLE: global daily quota exhausted or provider unavailable; AI_NOT_CONFIGURED: provider not configured.',
  })
  parseTransaction(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ParseTransactionDto,
  ): Promise<ParseTransactionResponse> {
    return this.ai.parseTransaction(user.sub, dto);
  }
}
