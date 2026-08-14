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
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Account, JwtPayload } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

/**
 * 帳戶端點。與分類／交易不同，這裡**不在 `/ledgers/:id` 之下**，也不掛
 * `LedgerAccessGuard`——帳戶屬於使用者，跨帳本共用，與帳本角色無關。
 *
 * 授權模型比照 `UsersController` 的 `me` 端點：目標使用者一律取自 JWT
 * （`user.sub`），絕不取自路徑或 body。因此就算把路徑上的帳戶 id 換成別人的，
 * service 也會因為 `userId` 對不上而回 404。
 */
@ApiTags('accounts')
@ApiBearerAuth('jwt')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload): Promise<Account[]> {
    return this.accounts.list(user.sub);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateAccountDto): Promise<Account> {
    return this.accounts.create(user.sub, dto.name, dto.initialBalance);
  }

  @Patch(':accountId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('accountId') accountId: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<Account> {
    return this.accounts.update(user.sub, accountId, dto);
  }

  @Delete(':accountId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: JwtPayload, @Param('accountId') accountId: string): Promise<void> {
    return this.accounts.remove(user.sub, accountId);
  }
}
