import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, PaymentMethod } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 付款方式的業務邏輯。付款方式永遠隸屬某個帳本，但（與分類不同）不綁 type，
 * 收入 / 支出共用同一組。兩條主要規則：同一帳本下名稱唯一；只要有交易（含已軟
 * 刪除者）引用，就不得刪除該付款方式。整體形狀比照 CategoriesService。
 */

/** 從資料庫選出的付款方式資料列。 */
interface PaymentMethodRow {
  id: string;
  ledgerId: string;
  name: string;
  createdAt: Date;
}

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** 列出帳本的付款方式（無型別篩選，付款方式不綁 type）。 */
  async list(ledgerId: string): Promise<PaymentMethod[]> {
    const paymentMethods = await this.prisma.paymentMethod.findMany({
      where: { ledgerId },
      orderBy: { createdAt: 'asc' },
    });
    return paymentMethods.map((paymentMethod) => this.toPaymentMethod(paymentMethod));
  }

  /** 新增付款方式。名稱在帳本內必須唯一（靠 DB 唯一索引擋重複）。 */
  async create(ledgerId: string, name: string): Promise<PaymentMethod> {
    try {
      const paymentMethod = await this.prisma.paymentMethod.create({
        data: { ledgerId, name },
      });
      return this.toPaymentMethod(paymentMethod);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** 付款方式改名。 */
  async rename(ledgerId: string, paymentMethodId: string, name: string): Promise<PaymentMethod> {
    await this.getOwned(ledgerId, paymentMethodId);
    try {
      const paymentMethod = await this.prisma.paymentMethod.update({
        where: { id: paymentMethodId },
        data: { name },
      });
      return this.toPaymentMethod(paymentMethod);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.nameTaken();
      }
      throw error;
    }
  }

  /** 刪除付款方式，除非有任何交易引用它。 */
  async remove(ledgerId: string, paymentMethodId: string): Promise<void> {
    await this.getOwned(ledgerId, paymentMethodId);

    // 計數包含已軟刪除的交易：歷史紀錄必須保持可追溯（付款方式名不能憑空消失）。
    const referencing = await this.prisma.transaction.count({
      where: { paymentMethodId },
    });
    if (referencing > 0) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_METHOD_IN_USE,
        'Cannot delete a payment method that transactions reference.',
      );
    }

    await this.prisma.paymentMethod.delete({ where: { id: paymentMethodId } });
  }

  /**
   * 載入付款方式並確認它屬於指定帳本。不符時一律回 404，避免呼叫者藉此探測其他
   * 帳本裡有哪些付款方式。
   */
  private async getOwned(ledgerId: string, paymentMethodId: string): Promise<PaymentMethodRow> {
    const paymentMethod = await this.prisma.paymentMethod.findUnique({
      where: { id: paymentMethodId },
    });
    if (!paymentMethod || paymentMethod.ledgerId !== ledgerId) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
        'Payment method not found.',
      );
    }
    return paymentMethod;
  }

  private nameTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.PAYMENT_METHOD_NAME_TAKEN,
      'A payment method with this name already exists.',
    );
  }

  private toPaymentMethod(paymentMethod: PaymentMethodRow): PaymentMethod {
    return {
      id: paymentMethod.id,
      name: paymentMethod.name,
      createdAt: paymentMethod.createdAt.toISOString(),
    };
  }
}
