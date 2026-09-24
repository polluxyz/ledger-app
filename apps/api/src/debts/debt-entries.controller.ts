import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { CreateDebtEntryResponse, DebtEntry, JwtPayload } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DebtEntriesService } from './debt-entries.service';
import { CreateDebtEntryDto } from './dto/create-debt-entry.dto';
import { UpdateDebtEntryDto } from './dto/update-debt-entry.dto';

/**
 * 往來紀錄（spec 3b §5.2）。帳本 id 在 body 的 `record` 裡，不在路徑上，所以帳本權限由
 * service 用 `assertLedgerWritable` 做與 guard 相同的檢查。
 */
@ApiTags('debt-entries')
@ApiBearerAuth('jwt')
@Controller('debt-entries')
export class DebtEntriesController {
  constructor(private readonly entries: DebtEntriesService) {}

  @Post()
  @ApiNotFoundResponse({
    description: 'The counterparty, ledger, account or category is not accessible.',
  })
  @ApiForbiddenResponse({ description: 'The caller is only a VIEWER of the ledger in `record`.' })
  @ApiConflictResponse({ description: 'LEDGER_ARCHIVED.' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateDebtEntryDto,
  ): Promise<CreateDebtEntryResponse> {
    return this.entries.create(user.sub, dto);
  }

  @Patch(':id')
  @ApiNotFoundResponse({ description: 'No such entry, or it is not yours.' })
  @ApiConflictResponse({ description: 'DEBT_ENTRY_NOT_EDITABLE.' })
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateDebtEntryDto,
  ): Promise<DebtEntry> {
    return this.entries.update(user.sub, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'No such entry, or it is not yours.' })
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.entries.remove(user.sub, id);
  }
}
