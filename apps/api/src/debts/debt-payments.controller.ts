import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Debt, JwtPayload } from '@ledger/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { DebtPaymentsService } from './debt-payments.service';
import { CreateDebtPaymentDto } from './dto/create-debt-payment.dto';

/**
 * 債務的還款與免除，巢狀在 `/debts/{id}` 之下。授權規則與 `DebtsController` 相同：
 * 不是自己的債務一律 404。
 */
@ApiTags('debts')
@ApiBearerAuth('jwt')
@Controller('debts/:id')
export class DebtPaymentsController {
  constructor(private readonly payments: DebtPaymentsService) {}

  @Post('payments')
  @ApiNotFoundResponse({ description: 'No such debt, or the ledger or account is not accessible.' })
  @ApiForbiddenResponse({ description: 'The caller is only a VIEWER of the target ledger.' })
  @ApiConflictResponse({ description: 'DEBT_NOT_OPEN, DEBT_OVERPAYMENT or LEDGER_ARCHIVED.' })
  create(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreateDebtPaymentDto,
  ): Promise<Debt> {
    return this.payments.create(user.sub, id, dto);
  }

  @Delete('payments/:paymentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNotFoundResponse({ description: 'No such debt or payment, or it is not yours.' })
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ): Promise<void> {
    return this.payments.remove(user.sub, id, paymentId);
  }

  @Post('forgive')
  @HttpCode(HttpStatus.OK)
  @ApiNotFoundResponse({ description: 'No such debt, or it is not yours.' })
  @ApiConflictResponse({ description: 'DEBT_NOT_FORGIVABLE (you borrowed it) or DEBT_NOT_OPEN.' })
  forgive(@CurrentUser() user: JwtPayload, @Param('id') id: string): Promise<Debt> {
    return this.payments.forgive(user.sub, id);
  }
}
