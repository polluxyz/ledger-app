import { ApiProperty } from '@nestjs/swagger';
import { LEDGER_KINDS, LEDGER_ROLES } from '@ledger/shared';
import type { LedgerDetail, LedgerKind, LedgerMemberInfo, LedgerRole } from '@ledger/shared';

class LedgerMemberDto implements LedgerMemberInfo {
  @ApiProperty() userId!: string;
  @ApiProperty() email!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: LEDGER_ROLES }) role!: LedgerRole;
}

/** 與 archive／detail 共用的完整帳本回應契約。 */
export class LedgerDetailDto implements LedgerDetail {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: LEDGER_KINDS }) kind!: LedgerKind;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) archivedAt!: string | null;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: [LedgerMemberDto] }) members!: LedgerMemberDto[];
  @ApiProperty() left!: boolean;
}
