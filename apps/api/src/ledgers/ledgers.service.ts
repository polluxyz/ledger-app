import { Injectable } from '@nestjs/common';
import { DEFAULT_CATEGORIES } from '@ledger/shared';
import { Prisma } from '../generated/prisma/client';

@Injectable()
export class LedgersService {
  /**
   * Creates a ledger owned by the given user, seeded with the default
   * categories. Runs on a caller-provided transaction client so it can be
   * composed atomically with other writes (e.g. user registration).
   */
  async createLedgerForUser(tx: Prisma.TransactionClient, userId: string, name: string) {
    const ledger = await tx.ledger.create({ data: { name } });

    await tx.ledgerMember.create({
      data: { ledgerId: ledger.id, userId, role: 'OWNER' },
    });

    await tx.category.createMany({
      data: DEFAULT_CATEGORIES.map((category) => ({
        ledgerId: ledger.id,
        name: category.name,
        type: category.type,
      })),
    });

    return ledger;
  }
}
