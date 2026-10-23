import { Transform } from 'class-transformer';
import { IsString, IsUUID, Length, ValidateBy } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AI_TEXT_MAX_LENGTH, type ParseTransactionRequest } from '@ledger/shared';
import { isRealDate } from '../ai-draft-validation';

/** 先去句子前後空白，再驗證長度；日期與模型輸出共用相同的日曆規則。 */
export class ParseTransactionDto implements ParseTransactionRequest {
  @ApiProperty({ type: String, minLength: 1, maxLength: AI_TEXT_MAX_LENGTH })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, AI_TEXT_MAX_LENGTH)
  text!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  @IsUUID()
  ledgerId!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-10-21' })
  @ValidateBy({
    name: 'isRealDate',
    validator: {
      validate: isRealDate,
      defaultMessage: () => 'today must be a real YYYY-MM-DD date',
    },
  })
  today!: string;
}
