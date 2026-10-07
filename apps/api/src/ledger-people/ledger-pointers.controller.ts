import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerPointerResponse } from '@ledger/shared';
import { AllowOnArchived } from '../common/decorators/allow-on-archived.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { LeftMemberAccess } from '../common/decorators/left-member-access.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { LedgerPointerResponseDto, SetLedgerPointerDto } from './dto/set-ledger-pointer.dto';
import { LedgerPointersService } from './ledger-pointers.service';

/**
 * 指向端點只收取輸入與回傳有效指向；歸屬檢查與設定都由 service 執行。
 *
 * 兩個 class 層級的裝飾器由 guard 解讀：已退出的人回 409 `LEDGER_LEFT`（spec §4.1，
 * 不是 404，因為他確實參與過、只是不能再寫）；封存帳本仍可設定，因為指向是我自己的設定，
 * 不是帳本資料（決策 144 讓封存帳本照樣出現在借還頁）。
 */
@ApiTags('ledger-people')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@LeftMemberAccess('reject')
@AllowOnArchived()
@Controller('ledgers/:ledgerId/people/:personId/pointer')
export class LedgerPointersController {
  constructor(private readonly pointers: LedgerPointersService) {}

  @Put()
  @RequireLedgerRole('VIEWER')
  @ApiOkResponse({ type: LedgerPointerResponseDto })
  set(
    @CurrentUser() user: JwtPayload,
    @Param('ledgerId') ledgerId: string,
    @Param('personId') personId: string,
    @Body() dto: SetLedgerPointerDto,
  ): Promise<LedgerPointerResponse> {
    return this.pointers.set(user.sub, ledgerId, personId, dto.counterpartyId);
  }

  @Delete()
  @RequireLedgerRole('VIEWER')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: LedgerPointerResponseDto })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('ledgerId') ledgerId: string,
    @Param('personId') personId: string,
  ): Promise<LedgerPointerResponse> {
    return this.pointers.remove(user.sub, ledgerId, personId);
  }
}
