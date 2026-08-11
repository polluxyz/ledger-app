import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { UpdatePaymentMethodRequest } from '@ledger/shared';

/** 付款方式改名的請求形狀。 */
export class UpdatePaymentMethodDto implements UpdatePaymentMethodRequest {
  @ApiProperty({ example: '信用卡', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}
