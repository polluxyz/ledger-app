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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerPerson } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CreateGuestDto } from './dto/create-guest.dto';
import { RenameGuestDto } from './dto/rename-guest.dto';
import { LedgerPeopleService } from './ledger-people.service';

/**
 * 共享帳本的 people 端點。guard 先確認帳本成員與角色；service 再確認帳本類型與資源歸屬。
 */
@ApiTags('ledger-people')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/people')
export class LedgerPeopleController {
  constructor(private readonly people: LedgerPeopleService) {}

  @Get()
  @RequireLedgerRole('VIEWER')
  list(@Param('ledgerId') ledgerId: string): Promise<LedgerPerson[]> {
    return this.people.list(ledgerId);
  }

  @Post()
  @RequireLedgerRole('EDITOR')
  create(
    @CurrentUser() user: JwtPayload,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreateGuestDto,
  ): Promise<LedgerPerson> {
    return this.people.createGuest(ledgerId, dto.name, user.sub, dto.counterpartyId);
  }

  @Patch(':id')
  @RequireLedgerRole('EDITOR')
  rename(
    @Param('ledgerId') ledgerId: string,
    @Param('id') personId: string,
    @Body() dto: RenameGuestDto,
  ): Promise<LedgerPerson> {
    return this.people.renameGuest(ledgerId, personId, dto.name);
  }

  @Delete(':id')
  @RequireLedgerRole('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('ledgerId') ledgerId: string, @Param('id') personId: string): Promise<void> {
    return this.people.removeGuest(ledgerId, personId);
  }
}
