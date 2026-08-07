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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload, LedgerDetail, LedgerSummary } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateLedgerDto } from './dto/update-ledger.dto';
import { LedgerAccessGuard } from './guards/ledger-access.guard';
import { LedgersService } from './ledgers.service';

@ApiTags('ledgers')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers')
export class LedgersController {
  constructor(private readonly ledgers: LedgersService) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateLedgerDto): Promise<LedgerSummary> {
    return this.ledgers.create(user.sub, dto.name);
  }

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<LedgerSummary[]> {
    return this.ledgers.listForUser(user.sub);
  }

  @Get(':ledgerId')
  @RequireLedgerRole('VIEWER')
  detail(@Param('ledgerId') ledgerId: string): Promise<LedgerDetail> {
    return this.ledgers.getDetail(ledgerId);
  }

  @Patch(':ledgerId')
  @RequireLedgerRole('OWNER')
  rename(@Param('ledgerId') ledgerId: string, @Body() dto: UpdateLedgerDto): Promise<LedgerDetail> {
    return this.ledgers.rename(ledgerId, dto.name);
  }

  @Delete(':ledgerId')
  @RequireLedgerRole('OWNER')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiQuery({ name: 'confirm', description: 'Must equal the ledger name.' })
  remove(@Param('ledgerId') ledgerId: string, @Query('confirm') confirm: string): Promise<void> {
    return this.ledgers.remove(ledgerId, confirm);
  }
}
