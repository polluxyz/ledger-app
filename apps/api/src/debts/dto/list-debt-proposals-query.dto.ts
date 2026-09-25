import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DEBT_PROPOSAL_DIRECTIONS, DEBT_PROPOSAL_STATUSES } from '@ledger/shared';
import type {
  DebtProposalDirection,
  DebtProposalStatus,
  ListDebtProposalsQuery,
} from '@ledger/shared';

/**
 * `GET /debt-proposals` 的查詢字串。`direction` 必填：收到的與送出的在畫面上是兩個清單。
 * 分頁預設與上限由 service 套用。
 */
export class ListDebtProposalsQueryDto implements ListDebtProposalsQuery {
  @ApiProperty({ enum: DEBT_PROPOSAL_DIRECTIONS })
  @IsIn(DEBT_PROPOSAL_DIRECTIONS)
  direction!: DebtProposalDirection;

  @ApiPropertyOptional({ enum: DEBT_PROPOSAL_STATUSES })
  @IsOptional()
  @IsIn(DEBT_PROPOSAL_STATUSES)
  status?: DebtProposalStatus;

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
