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
} from '@nestjs/common';
import { ApiBearerAuth, ApiConflictResponse, ApiNotFoundResponse, ApiTags } from '@nestjs/swagger';
import type {
  Counterparty,
  CreateDebtEntryResponse,
  DebtEntry,
  JwtPayload,
  Paginated,
} from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CounterpartiesService } from './counterparties.service';
import { ListCounterpartiesQueryDto } from './dto/list-counterparties-query.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';

/**
 * 往來對象（spec 3b §5.1）。對象屬於使用者、不屬於帳本（決策 17），所以不在
 * `/ledgers/{id}` 之下，也不套 `LedgerAccessGuard`。授權在 service：只有擁有者看得到，
 * 其他人一律 404。
 */
@ApiTags('counterparties')
@ApiBearerAuth('jwt')
@Controller('counterparties')
export class CounterpartiesController {
  constructor(private readonly counterparties: CounterpartiesService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListCounterpartiesQueryDto,
  ): Promise<Paginated<Counterparty>> {
    return this.counterparties.list(user.sub, query);
  }

  @Get(':id')
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<Counterparty> {
    return this.counterparties.get(user.sub, id);
  }

  @Patch(':id')
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  @ApiConflictResponse({ description: 'COUNTERPARTY_NAME_TAKEN.' })
  rename(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCounterpartyDto,
  ): Promise<Counterparty> {
    return this.counterparties.rename(user.sub, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  @ApiConflictResponse({ description: 'COUNTERPARTY_HAS_ENTRIES.' })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.counterparties.remove(user.sub, id);
  }

  @Get(':id/entries')
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  entries(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query() query: ListCounterpartiesQueryDto,
  ): Promise<Paginated<DebtEntry>> {
    return this.counterparties.entries(user.sub, id, query);
  }

  @Post(':id/forgive')
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  @ApiConflictResponse({ description: 'NOTHING_TO_FORGIVE.' })
  forgive(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<CreateDebtEntryResponse> {
    return this.counterparties.forgive(user.sub, id);
  }
}
