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
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type {
  Counterparty,
  CreateDebtEntryResponse,
  DebtEntry,
  FriendInviteLinkCreated,
  FriendRequest,
  JwtPayload,
  Paginated,
} from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateFriendRequestDto } from '../friends/dto/create-friend-request.dto';
import { FriendInviteLinksService } from '../friends/friend-invite-links.service';
import { FriendRequestsService } from '../friends/friend-requests.service';
import { FRIEND_THROTTLE } from '../friends/friends-throttle';
import { CounterpartiesService } from './counterparties.service';
import { CreateCounterpartyDto } from './dto/create-counterparty.dto';
import { ListCounterpartiesQueryDto } from './dto/list-counterparties-query.dto';
import { UpdateCounterpartyDto } from './dto/update-counterparty.dto';

/**
 * 往來對象（spec 3b §5.1）。對象屬於使用者、不屬於帳本（決策 17），所以不在
 * `/ledgers/{id}` 之下，也不套 `LedgerAccessGuard`。授權在 service：只有擁有者看得到，
 * 其他人一律 404。
 *
 * 連動邀請（3b-2 §5.1）從對象發出，但邀請本身沿用 3a 的好友邀請與邀請連結（決策 56），
 * 所以這兩個端點交給好友模組的 service，限流也沿用好友端點的設定。
 */
@ApiTags('counterparties')
@ApiBearerAuth('jwt')
@Controller('counterparties')
export class CounterpartiesController {
  constructor(
    private readonly counterparties: CounterpartiesService,
    private readonly friendRequests: FriendRequestsService,
    private readonly inviteLinks: FriendInviteLinksService,
  ) {}

  @Post()
  @ApiConflictResponse({ description: 'COUNTERPARTY_NAME_TAKEN.' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCounterpartyDto,
  ): Promise<Counterparty> {
    return this.counterparties.create(user.sub, dto.name);
  }

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
  @ApiConflictResponse({ description: 'COUNTERPARTY_HAS_ENTRIES or COUNTERPARTY_LINKED.' })
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

  @Post(':id/link-invites')
  @Throttle(FRIEND_THROTTLE)
  @ApiBadRequestResponse({ description: 'CANNOT_FRIEND_SELF, or the email is malformed.' })
  @ApiNotFoundResponse({ description: 'Not your counterparty, or USER_NOT_FOUND.' })
  @ApiConflictResponse({
    description: 'ALREADY_LINKED, LINK_INVITE_FROM_THEM, or FRIEND_REQUEST_PENDING.',
  })
  @ApiTooManyRequestsResponse({ description: 'More than 10 requests per minute from one IP.' })
  createLinkInvite(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<FriendRequest> {
    return this.friendRequests.createLinkInvite(user.sub, id, dto.email);
  }

  @Post(':id/invite-links')
  @Throttle(FRIEND_THROTTLE)
  @ApiNotFoundResponse({ description: 'No such counterparty, or it is not yours.' })
  @ApiConflictResponse({ description: 'ALREADY_LINKED.' })
  @ApiTooManyRequestsResponse({ description: 'More than 10 requests per minute from one IP.' })
  createInviteLink(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ): Promise<FriendInviteLinkCreated> {
    return this.inviteLinks.create(user.sub, id);
  }

  @Delete(':id/link')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'Not your counterparty, or it is not linked.' })
  unlink(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<void> {
    return this.counterparties.unlink(user.sub, id);
  }
}
