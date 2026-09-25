import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FriendRequest, JwtPayload, Paginated } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AcceptFriendRequestDto } from './dto/accept-friend-request.dto';
import { CreateFriendRequestDto } from './dto/create-friend-request.dto';
import { ListFriendRequestsQueryDto } from './dto/list-friend-requests-query.dto';
import { FriendRequestsService } from './friend-requests.service';
import { FRIEND_THROTTLE } from './friends-throttle';

/**
 * 以 email 送出的好友邀請。
 *
 * 授權不靠 guard：每個動作的「誰能做」取決於呼叫者是這筆邀請的發起者、收件者還是外人
 * （spec §3.3），這要先讀出邀請才知道，所以在 service 裡判斷。非當事人一律 404，
 * 當事人但動作不對回 403。
 */
@ApiTags('friend-requests')
@ApiBearerAuth('jwt')
@Controller('friend-requests')
export class FriendRequestsController {
  constructor(private readonly requests: FriendRequestsService) {}

  @Post()
  @Throttle(FRIEND_THROTTLE)
  @ApiBadRequestResponse({ description: 'CANNOT_FRIEND_SELF, or the email is malformed.' })
  @ApiNotFoundResponse({ description: 'USER_NOT_FOUND: no registered user has that email.' })
  @ApiConflictResponse({ description: 'ALREADY_FRIENDS or FRIEND_REQUEST_PENDING.' })
  @ApiTooManyRequestsResponse({ description: 'More than 10 requests per minute from one IP.' })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateFriendRequestDto,
  ): Promise<FriendRequest> {
    return this.requests.create(user.sub, dto.email);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query() query: ListFriendRequestsQueryDto,
  ): Promise<Paginated<FriendRequest>> {
    return this.requests.list(user.sub, query);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiForbiddenResponse({ description: 'Only the recipient can accept.' })
  @ApiNotFoundResponse({ description: 'No such request, or the caller is not a party to it.' })
  @ApiBadRequestResponse({
    description: 'A link invite needs counterparty; a plain friend request must not have one.',
  })
  @ApiConflictResponse({
    description:
      'FRIEND_REQUEST_NOT_PENDING; for link invites also ALREADY_LINKED, COUNTERPARTY_LINKED, COUNTERPARTY_NAME_TAKEN.',
  })
  accept(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: AcceptFriendRequestDto,
  ): Promise<FriendRequest> {
    return this.requests.accept(user.sub, id, dto.counterparty);
  }

  @Post(':id/decline')
  @HttpCode(HttpStatus.OK)
  @ApiForbiddenResponse({ description: 'Only the recipient can decline.' })
  @ApiNotFoundResponse({ description: 'No such request, or the caller is not a party to it.' })
  @ApiConflictResponse({ description: 'FRIEND_REQUEST_NOT_PENDING.' })
  decline(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<FriendRequest> {
    return this.requests.decline(user.sub, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiForbiddenResponse({ description: 'Only the requester can cancel.' })
  @ApiNotFoundResponse({ description: 'No such request, or the caller is not a party to it.' })
  @ApiConflictResponse({ description: 'FRIEND_REQUEST_NOT_PENDING.' })
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<FriendRequest> {
    return this.requests.cancel(user.sub, id);
  }
}
