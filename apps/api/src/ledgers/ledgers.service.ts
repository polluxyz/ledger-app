import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_CATEGORIES,
  ErrorCode,
  LedgerDetail,
  LedgerRole,
  LedgerSummary,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** A ledger row as selected from the database. */
interface LedgerRow {
  id: string;
  name: string;
  currency: string;
  createdAt: Date;
}

@Injectable()
export class LedgersService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** Creates a standalone ledger; the creator becomes its OWNER. */
  async create(userId: string, name: string): Promise<LedgerSummary> {
    const ledger = await this.prisma.$transaction((tx) =>
      this.createLedgerForUser(tx, userId, name),
    );
    return this.toSummary(ledger, 'OWNER');
  }

  /** Lists the ledgers the user belongs to, each with their own role. */
  async listForUser(userId: string): Promise<LedgerSummary[]> {
    const memberships = await this.prisma.ledgerMember.findMany({
      where: { userId },
      include: { ledger: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((membership) => this.toSummary(membership.ledger, membership.role));
  }

  /** Returns a ledger with its full member list. Access is enforced upstream. */
  async getDetail(ledgerId: string): Promise<LedgerDetail> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
      include: { members: { include: { user: true } } },
    });
    if (!ledger) {
      throw this.notFound();
    }

    return {
      ...this.toLedger(ledger),
      members: ledger.members.map((member) => ({
        userId: member.userId,
        email: member.user.email,
        name: member.user.name,
        role: member.role,
      })),
    };
  }

  /** Renames a ledger and returns its refreshed detail. */
  async rename(ledgerId: string, name: string): Promise<LedgerDetail> {
    await this.prisma.ledger.update({ where: { id: ledgerId }, data: { name } });
    return this.getDetail(ledgerId);
  }

  /**
   * Deletes a ledger (cascading to members and categories). Requires the
   * caller to echo the ledger name in `confirm` as a guard against accidental
   * deletion of shared data.
   */
  async remove(ledgerId: string, confirm: string | undefined): Promise<void> {
    const ledger = await this.prisma.ledger.findUnique({
      where: { id: ledgerId },
    });
    if (!ledger) {
      throw this.notFound();
    }
    if (confirm !== ledger.name) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
        'confirm must exactly match the ledger name.',
      );
    }
    await this.prisma.ledger.delete({ where: { id: ledgerId } });
  }

  private toLedger(ledger: LedgerRow) {
    return {
      id: ledger.id,
      name: ledger.name,
      currency: ledger.currency,
      createdAt: ledger.createdAt.toISOString(),
    };
  }

  private toSummary(ledger: LedgerRow, role: LedgerRole): LedgerSummary {
    return { ...this.toLedger(ledger), role };
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }
}
