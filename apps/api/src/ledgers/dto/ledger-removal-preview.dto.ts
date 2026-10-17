import { ApiProperty } from '@nestjs/swagger';
import type { LedgerRemovalPreview } from '@ledger/shared';

type RemovalAccount = LedgerRemovalPreview['accounts'][number];
type RemovalCounterparty = LedgerRemovalPreview['counterparties'][number];
type RemovalPermission = LedgerRemovalPreview['delete'];

class RemovalAccountDto implements RemovalAccount {
  @ApiProperty() accountId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ type: Number, description: 'Integer cents.' }) balance!: number;
  @ApiProperty({ type: Number, description: 'Integer cents after deletion.' })
  balanceAfter!: number;
}

class RemovalCounterpartyDto implements RemovalCounterparty {
  @ApiProperty() counterpartyId!: string;
  @ApiProperty() displayName!: string;
  @ApiProperty() linked!: boolean;
  @ApiProperty({ type: Number }) balance!: number;
  @ApiProperty({ type: Number }) balanceAfter!: number;
}

class RemovalPermissionDto implements RemovalPermission {
  @ApiProperty() allowed!: boolean;
  @ApiProperty({
    enum: ['LEDGER_ARCHIVED', 'HAS_OTHERS_TRANSACTIONS', 'SHARED_HAS_DEBTS'],
    nullable: true,
  })
  blockedBy!: LedgerRemovalPreview['delete']['blockedBy'];
}

export class LedgerRemovalPreviewDto implements LedgerRemovalPreview {
  @ApiProperty({ type: [RemovalAccountDto] }) accounts!: RemovalAccountDto[];
  @ApiProperty({ type: [RemovalCounterpartyDto] }) counterparties!: RemovalCounterpartyDto[];
  @ApiProperty() withdrawsDebts!: boolean;
  @ApiProperty({ type: RemovalPermissionDto }) delete!: RemovalPermissionDto;
}
