import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateIf, ValidateNested } from 'class-validator';
import type { AcceptDebtProposalRequest } from '@ledger/shared';
import { DebtEntryRecordTargetDto } from './debt-entry-record-target.dto';

/**
 * `POST /debt-proposals/{id}/accept` 的 body。
 *
 * `record` 要不要帶取決於提議的種類（只有會產生交易的「新增」要帶，而且物件或 `null` 都算
 * 「帶了」），這要讀出提議才知道，所以由 service 檢查；這裡只驗有值時的格式。
 */
export class AcceptDebtProposalDto implements AcceptDebtProposalRequest {
  @ApiPropertyOptional({ type: DebtEntryRecordTargetDto, nullable: true })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @ValidateNested()
  @Type(() => DebtEntryRecordTargetDto)
  record?: DebtEntryRecordTargetDto | null;
}
