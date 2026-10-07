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
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { LedgerPointerResponseDto, SetLedgerPointerDto } from './dto/set-ledger-pointer.dto';
import { LedgerPointersService } from './ledger-pointers.service';

/** 指向端點只收取輸入與回傳有效指向；歸屬檢查與設定都由 service 執行。 */
@ApiTags('ledger-people')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
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
