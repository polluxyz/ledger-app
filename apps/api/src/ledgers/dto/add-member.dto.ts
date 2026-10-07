import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsUUID,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { LEDGER_ROLES } from '@ledger/shared';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';
import type { LedgerRole } from '@ledger/shared';

@ValidatorConstraint({ name: 'exactlyOneMemberIdentifier', async: false })
class ExactlyOneMemberIdentifierConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const body = args.object as { email?: unknown; counterpartyId?: unknown };
    return (body.email !== undefined) !== (body.counterpartyId !== undefined);
  }

  defaultMessage(): string {
    return 'Exactly one of email or counterpartyId must be provided.';
  }
}

/**
 * 加入成員允許 email 與已連動對象兩種入口，但只接受其中一種。
 * 欄位各自選填是為了讓 DTO 能描述兩個形狀；角色上的類別驗證會拒絕同時缺少或同時出現。
 */
export class AddMemberDto {
  @ApiPropertyOptional({
    example: 'bob@example.com',
    format: 'email',
    description: '與 counterpartyId 擇一提供。',
  })
  @NormalizeEmail()
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: '與 email 擇一提供；必須是呼叫者已連動的對象。',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsUUID()
  counterpartyId?: string;

  @ApiProperty({ enum: LEDGER_ROLES, example: 'EDITOR' })
  @IsIn(LEDGER_ROLES)
  @Validate(ExactlyOneMemberIdentifierConstraint)
  role!: LedgerRole;
}
