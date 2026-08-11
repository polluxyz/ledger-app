import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { PaymentMethod } from '@ledger/shared';
import { RequireLedgerRole } from '../common/decorators/require-ledger-role.decorator';
import { LedgerAccessGuard } from '../ledgers/guards/ledger-access.guard';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

/**
 * 付款方式端點，巢狀在 `/ledgers/:ledgerId/payment-methods`。讀取需 VIEWER；
 * 新增／改名／刪除需 EDITOR。授權由 LedgerAccessGuard + @RequireLedgerRole 把關
 * （比照 categories）。
 */
@ApiTags('payment-methods')
@ApiBearerAuth('jwt')
@UseGuards(LedgerAccessGuard)
@Controller('ledgers/:ledgerId/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  @RequireLedgerRole('VIEWER')
  list(@Param('ledgerId') ledgerId: string): Promise<PaymentMethod[]> {
    return this.paymentMethods.list(ledgerId);
  }

  @Post()
  @RequireLedgerRole('EDITOR')
  create(
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethod> {
    return this.paymentMethods.create(ledgerId, dto.name);
  }

  @Patch(':paymentMethodId')
  @RequireLedgerRole('EDITOR')
  rename(
    @Param('ledgerId') ledgerId: string,
    @Param('paymentMethodId') paymentMethodId: string,
    @Body() dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethod> {
    return this.paymentMethods.rename(ledgerId, paymentMethodId, dto.name);
  }

  @Delete(':paymentMethodId')
  @RequireLedgerRole('EDITOR')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @Param('ledgerId') ledgerId: string,
    @Param('paymentMethodId') paymentMethodId: string,
  ): Promise<void> {
    return this.paymentMethods.remove(ledgerId, paymentMethodId);
  }
}
