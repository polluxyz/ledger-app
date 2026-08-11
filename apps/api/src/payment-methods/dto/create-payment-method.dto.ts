import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { CreatePaymentMethodRequest } from '@ledger/shared';

/** 新增付款方式的請求形狀：僅需名稱（不綁 type）。 */
export class CreatePaymentMethodDto implements CreatePaymentMethodRequest {
  @ApiProperty({ example: '現金', minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;
}
