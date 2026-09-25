import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { DebtProposal, JwtPayload, Paginated } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DebtProposalsService } from './debt-proposals.service';
import { AcceptDebtProposalDto } from './dto/accept-debt-proposal.dto';
import { ListDebtProposalsQueryDto } from './dto/list-debt-proposals-query.dto';

/**
 * 連動後送給對方確認的提議（spec 3b-2 §5.3）。
 *
 * 授權在 service：只有接受者能接受或拒絕，發起者 403，其他人 404。
 */
@ApiTags('debt-proposals')
@ApiBearerAuth('jwt')
@Controller('debt-proposals')
export class DebtProposalsController {
  constructor(private readonly proposals: DebtProposalsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListDebtProposalsQueryDto,
  ): Promise<Paginated<DebtProposal>> {
    return this.proposals.list(user.sub, query);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiBadRequestResponse({ description: 'record is missing, or not allowed for this proposal.' })
  @ApiForbiddenResponse({ description: 'Only the recipient can accept.' })
  @ApiNotFoundResponse({ description: 'No such proposal, or the caller is not a party to it.' })
  @ApiConflictResponse({
    description:
      'PROPOSAL_NOT_PENDING, NOTHING_TO_REPAY, REPAYMENT_EXCEEDS_BALANCE, or LEDGER_ARCHIVED.',
  })
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AcceptDebtProposalDto,
  ): Promise<DebtProposal> {
    return this.proposals.accept(user.sub, id, dto.record);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiForbiddenResponse({ description: 'Only the recipient can decline.' })
  @ApiNotFoundResponse({ description: 'No such proposal, or the caller is not a party to it.' })
  @ApiConflictResponse({ description: 'PROPOSAL_NOT_PENDING.' })
  decline(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<DebtProposal> {
    return this.proposals.decline(user.sub, id);
  }
}
