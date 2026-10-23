import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
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
  @ApiOkResponse({ description: 'Transaction drafts; nothing is persisted.' })
  parseTransaction(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ParseTransactionDto,
  ): Promise<ParseTransactionResponse> {
    return this.ai.parseTransaction(user.sub, dto);
  }
}
