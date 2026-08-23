import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LEDGER_KINDS } from '@ledger/shared';
import type { CreateLedgerRequest, LedgerKind } from '@ledger/shared';

/** 建立帳本的請求形狀（幣別暫用預設值）。 */
export class CreateLedgerDto implements CreateLedgerRequest {
  @ApiProperty({ example: '家庭帳本', minLength: 1, maxLength: 100 })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * 這本帳本是給自己記的，還是要與別人共用，預設 `PERSONAL`。
   *
   * **建立後不可變更**——私人帳本加不了成員，共享帳本也不會因為其他人退光而變回
   * 私人。想改請另建一本；轉換會讓「誰看得到我的帳」在使用者沒有心理準備時改變。
   */
  @ApiPropertyOptional({ enum: LEDGER_KINDS, default: 'PERSONAL' })
  @IsOptional()
  @IsIn(LEDGER_KINDS)
  kind?: LedgerKind;

  /**
   * 這本帳本的交易是否計入我的帳戶餘額，預設 true。
   *
   * **建立後不可變更**——事後改會讓餘額突然跳動，而使用者無從得知數字為何變了。
   * 選 false 適合臨時性、「錢不是我的」的帳本：出遊分帳、社團公款。
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  tracksBalance?: boolean;
}
