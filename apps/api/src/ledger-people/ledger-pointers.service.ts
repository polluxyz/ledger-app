import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type LedgerPointerResponse } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { loadEffectivePointers } from './ledger-pointers';

/**
 * 指向是呼叫者自己的設定。每次寫入前重查帳本成員、人的歸屬與對象所有權，
 * 避免只依賴路由 guard 或讓另一位使用者的資料存在與否洩漏出去。
 */
@Injectable()
export class LedgerPointersService {
  constructor(private readonly prisma: PrismaService) {}

  async set(
    userId: string,
    ledgerId: string,
    personId: string,
    counterpartyId: string | null,
  ): Promise<LedgerPointerResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTarget(tx, userId, ledgerId, personId);
      if (counterpartyId !== null) {
        const counterparty = await tx.counterparty.findFirst({
          where: { id: counterpartyId, ownerId: userId },
          select: { id: true },
        });
        if (!counterparty) throw this.notFound();
      }
      await tx.ledgerPersonPointer.upsert({
        where: { userId_ledgerPersonId: { userId, ledgerPersonId: personId } },
        create: { userId, ledgerPersonId: personId, counterpartyId },
        update: { counterpartyId },
      });
      return (await loadEffectivePointers(tx, userId, [personId])).get(personId)!;
    });
  }

  async remove(userId: string, ledgerId: string, personId: string): Promise<LedgerPointerResponse> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTarget(tx, userId, ledgerId, personId);
      await tx.ledgerPersonPointer.deleteMany({ where: { userId, ledgerPersonId: personId } });
      return (await loadEffectivePointers(tx, userId, [personId])).get(personId)!;
    });
  }

  private async assertTarget(
    tx: Prisma.TransactionClient,
    userId: string,
    ledgerId: string,
    personId: string,
  ): Promise<void> {
    const member = await tx.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
      select: { userId: true },
    });
    if (!member) throw this.notFound();
    const person = await tx.ledgerPerson.findFirst({
      where: { id: personId, ledgerId, deletedAt: null },
      select: { userId: true },
    });
    if (!person) throw this.notFound();
    if (person.userId === userId) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'You cannot point to yourself in a ledger.',
      );
    }
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Resource not found.');
  }
}
