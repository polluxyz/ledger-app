import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerGroup } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LedgerDebtsService } from './ledger-debts.service';
import { ListLedgerGroupsQueryDto } from './dto/list-ledger-groups-query.dto';

/** 借還頁的帳本群組只從目前使用者參與過的共享帳本組成。 */
@ApiTags('ledger-groups')
@ApiBearerAuth('jwt')
@Controller('ledger-groups')
export class LedgerGroupsController {
  constructor(private readonly debts: LedgerDebtsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListLedgerGroupsQueryDto,
  ): Promise<LedgerGroup[]> {
    return this.debts.groups(user.sub, query.unpointed);
  }
}
