import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsUUID, ValidateIf } from 'class-validator';
import type { LedgerPointerResponse, SetLedgerPointerRequest } from '@ledger/shared';

/** null 是明確不指向；省略欄位不是同一個動作，因此必須擋在輸入邊界。 */
export class SetLedgerPointerDto implements SetLedgerPointerRequest {
  @ApiProperty({ type: String, format: 'uuid', nullable: true, required: true })
  @ValidateIf((_object: SetLedgerPointerDto, value: unknown) => value !== null)
  @IsDefined()
  @IsUUID()
  counterpartyId!: string | null;
}

/** OpenAPI 的有效指向回應，與 shared 契約同步。 */
export class LedgerPointerResponseDto implements LedgerPointerResponse {
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  counterpartyId!: string | null;

  @ApiProperty({ type: Boolean })
  auto!: boolean;
}
