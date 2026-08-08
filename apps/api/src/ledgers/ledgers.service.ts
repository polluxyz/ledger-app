import { HttpStatus, Injectable } from '@nestjs/common';
import {
  DEFAULT_CATEGORIES,
  ErrorCode,
  LedgerDetail,
  LedgerMemberInfo,
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

/** A membership row joined with its user, as selected for member responses. */
interface MemberRow {
  userId: string;
  role: LedgerRole;
  user: { email: string; name: string };
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
      members: ledger.members.map((member) => this.toMemberInfo(member)),
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

  /** Lists all members of a ledger. Access is enforced upstream. */
  async listMembers(ledgerId: string): Promise<LedgerMemberInfo[]> {
    const members = await this.prisma.ledgerMember.findMany({
      where: { ledgerId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((member) => this.toMemberInfo(member));
  }

  /** Adds an already-registered user (looked up by email) to the ledger. */
  async addMember(ledgerId: string, email: string, role: LedgerRole): Promise<LedgerMemberInfo> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new AppException(
        HttpStatus.NOT_FOUND,
        ErrorCode.USER_NOT_FOUND,
        'No registered user with that email.',
      );
    }

    const existing = await this.prisma.ledgerMember.findUnique({
      where: { ledgerId_userId: { ledgerId, userId: user.id } },
    });
    if (existing) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.ALREADY_MEMBER,
        'User is already a member of this ledger.',
      );
    }

    const member = await this.prisma.ledgerMember.create({
      data: { ledgerId, userId: user.id, role },
      include: { user: true },
    });
    return this.toMemberInfo(member);
  }

  /**
   * Changes a member's role. Demoting the ledger's last owner is rejected so a
   * ledger always keeps at least one owner. The owner count is re-checked
   * inside the transaction to avoid a race with concurrent changes.
   */
  async updateMemberRole(
    ledgerId: string,
    targetUserId: string,
    role: LedgerRole,
  ): Promise<LedgerMemberInfo> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (target.role === 'OWNER' && role !== 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      const updated = await tx.ledgerMember.update({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
        data: { role },
        include: { user: true },
      });
      return this.toMemberInfo(updated);
    });
  }

  /**
   * Removes a member. A user may always remove themselves (leave); removing
   * anyone else requires the acting user to be an owner. The last owner cannot
   * be removed.
   */
  async removeMember(ledgerId: string, targetUserId: string, actingUserId: string): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.ledgerMember.findUnique({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
      if (!target) {
        throw this.memberNotFound();
      }

      if (targetUserId !== actingUserId) {
        const acting = await tx.ledgerMember.findUnique({
          where: { ledgerId_userId: { ledgerId, userId: actingUserId } },
        });
        if (!acting || acting.role !== 'OWNER') {
          throw new AppException(
            HttpStatus.FORBIDDEN,
            ErrorCode.CANNOT_MANAGE_OTHER_MEMBER,
            'Only an owner can remove another member.',
          );
        }
      }

      if (target.role === 'OWNER') {
        await this.assertNotLastOwner(tx, ledgerId);
      }

      await tx.ledgerMember.delete({
        where: { ledgerId_userId: { ledgerId, userId: targetUserId } },
      });
    });
  }

  private async assertNotLastOwner(tx: Prisma.TransactionClient, ledgerId: string): Promise<void> {
    const owners = await tx.ledgerMember.count({
      where: { ledgerId, role: 'OWNER' },
    });
    if (owners <= 1) {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.LAST_OWNER_CANNOT_LEAVE,
        'A ledger must always have at least one owner.',
      );
    }
  }

  private toMemberInfo(member: MemberRow): LedgerMemberInfo {
    return {
      userId: member.userId,
      email: member.user.email,
      name: member.user.name,
      role: member.role,
    };
  }

  private memberNotFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Member not found.');
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
