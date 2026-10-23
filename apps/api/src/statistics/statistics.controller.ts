import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerStatistics, StatisticsTrend } from '@ledger/shared';
import { AllowOnArchived } from '../common/decorators/allow-on-archived.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { GetLedgerStatisticsDto, GetStatisticsTrendDto } from './dto/get-statistics.dto';
import {
  LedgerStatisticsResponseDto,
  StatisticsTrendResponseDto,
} from './dto/statistics-response.dto';
import { StatisticsService } from './statistics.service';

/** 成員皆可讀取歷史統計；controller 只接收已驗證輸入，歸屬與快照由 service 負責。 */
@ApiTags('statistics')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@RequireLedgerRole('VIEWER')
@AllowOnArchived()
@Controller('ledgers/:ledgerId/statistics')
export class StatisticsController {
  constructor(private readonly statistics: StatisticsService) {}

  @Get()
  @ApiOkResponse({ type: LedgerStatisticsResponseDto })
  getStatistics(
    @CurrentUser() user: JwtPayload,
    @Param('ledgerId') ledgerId: string,
    @Query() query: GetLedgerStatisticsDto,
  ): Promise<LedgerStatistics> {
    return this.statistics.getStatistics(user.sub, ledgerId, query);
  }

  @Get('trend')
  @ApiOkResponse({ type: StatisticsTrendResponseDto })
  getTrend(
    @CurrentUser() user: JwtPayload,
    @Param('ledgerId') ledgerId: string,
    @Query() query: GetStatisticsTrendDto,
  ): Promise<StatisticsTrend> {
    return this.statistics.getTrend(user.sub, ledgerId, query);
  }
}
