import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { FRIEND_REQUEST_DIRECTIONS, FRIEND_REQUEST_STATUSES } from '@ledger/shared';
import type {
  FriendRequestDirection,
  FriendRequestStatus,
  ListFriendRequestsQuery,
} from '@ledger/shared';

/**
 * `GET /friend-requests` 的查詢字串。`direction` 必填：「收到的」與「送出的」在畫面上
 * 是兩個清單，混在一起回傳沒有用處。分頁預設與上限由 service 套用。
 */
export class ListFriendRequestsQueryDto implements ListFriendRequestsQuery {
  @ApiProperty({ enum: FRIEND_REQUEST_DIRECTIONS })
  @IsIn(FRIEND_REQUEST_DIRECTIONS)
  direction!: FriendRequestDirection;

  @ApiPropertyOptional({ enum: FRIEND_REQUEST_STATUSES })
  @IsOptional()
  @IsIn(FRIEND_REQUEST_STATUSES)
  status?: FriendRequestStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
