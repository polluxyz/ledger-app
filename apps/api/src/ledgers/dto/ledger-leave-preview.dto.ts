import { ApiProperty } from '@nestjs/swagger';
import {
  LEDGER_LEAVE_BLOCKERS,
  LEDGER_LEAVE_ITEM_KINDS,
  type CategoryIcon,
  type LedgerLeavePreview,
} from '@ledger/shared';

class LeaveAccountEffectDto {
  @ApiProperty() accountId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Signed integer cents.' }) delta!: number;
}
class LeaveItemDto {
  @ApiProperty() id!: string;
  @ApiProperty({ format: 'date-time' }) date!: string;
  @ApiProperty({ type: String, nullable: true }) title!: string | null;
  @ApiProperty({ type: String, nullable: true }) categoryIcon!: CategoryIcon | null;
  @ApiProperty({ type: [LeaveAccountEffectDto] }) accountEffects!: LeaveAccountEffectDto[];
  @ApiProperty({ type: Number, nullable: true }) share!: number | null;
  @ApiProperty({ type: String, nullable: true }) paidByName!: string | null;
  @ApiProperty({ enum: LEDGER_LEAVE_ITEM_KINDS })
  kind!: LedgerLeavePreview['items'][number]['kind'];
}
class LeaveAccountImpactDto {
  @ApiProperty() accountId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() balance!: number;
  @ApiProperty() balanceAfter!: number;
}
class LeaveCarryOverDto {
  @ApiProperty() ledgerPersonId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty({ description: 'Signed integer cents; positive means owed to the caller.' })
  amount!: number;
  @ApiProperty({ type: String, nullable: true }) counterpartyId!: string | null;
}
class LeaveWithdrawalDto {
  @ApiProperty() counterpartyId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() linked!: boolean;
  @ApiProperty() balance!: number;
  @ApiProperty() balanceAfter!: number;
}
class LeavePermissionDto {
  @ApiProperty() allowed!: boolean;
  @ApiProperty({ enum: LEDGER_LEAVE_BLOCKERS, nullable: true })
  blockedBy!: LedgerLeavePreview['leave']['blockedBy'];
}
export class LedgerLeavePreviewDto implements LedgerLeavePreview {
  @ApiProperty({ type: [LeaveItemDto] }) items!: LeaveItemDto[];
  @ApiProperty({ type: [LeaveAccountImpactDto] }) accounts!: LeaveAccountImpactDto[];
  @ApiProperty({ type: [LeaveCarryOverDto] }) carryOvers!: LeaveCarryOverDto[];
  @ApiProperty({ type: [LeaveWithdrawalDto] }) withdrawals!: LeaveWithdrawalDto[];
  @ApiProperty({ type: LeavePermissionDto }) leave!: LeavePermissionDto;
}
