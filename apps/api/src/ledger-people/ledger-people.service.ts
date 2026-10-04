import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type LedgerPerson,
  type LedgerPerson as LedgerPersonView,
} from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * 共享帳本裡「可以分帳的人」的核心（3e 決策 136～140）：成員與非成員都是一筆 `LedgerPerson`。
 *
 * 所有方法都收呼叫端的交易 client，交易邊界由呼叫端決定。寫入名單、付款人、結清之前一律先
 * `lockPeople`：依 id 排序後 `FOR KEY SHARE`，跟刪除非成員的 `FOR UPDATE` 互斥，避免「剛確認
 * 沒被用到就被寫進名單」的競態；固定順序則避免 3c 遇過的死結。別本帳本的 id 一律 404，不透露存在。
 */

export interface LedgerPersonRecord {
  id: string;
  ledgerId: string;
  userId: string | null;
  name: string;
  status: 'MEMBER' | 'LEFT' | 'GUEST';
  createdAt: Date;
}

interface PersonRow {
  id: string;
  ledgerId: string;
  userId: string | null;
  name: string | null;
  deletedAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class LedgerPeopleService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureMemberPerson(tx: Prisma.TransactionClient, ledgerId: string, userId: string) {
    return tx.ledgerPerson.upsert({
      where: { ledgerId_userId: { ledgerId, userId } },
      create: { ledgerId, userId },
      update: {},
    });
  }

  async findCallerPerson(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    userId: string,
  ): Promise<LedgerPersonRecord | null> {
    const row = await tx.ledgerPerson.findUnique({
      where: { ledgerId_userId: { ledgerId, userId } },
    });
    if (!row) return null;
    const [user, member] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { name: true } }),
      tx.ledgerMember.findUnique({ where: { ledgerId_userId: { ledgerId, userId } } }),
    ]);
    return this.toRecord(row, user?.name ?? '', member !== null);
  }

  async lockPeople(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    personIds: readonly string[],
    options: { allowLeft: boolean | ReadonlySet<string> },
  ): Promise<Map<string, LedgerPersonRecord>> {
    const ids = [...new Set(personIds)].sort();
    const rows: PersonRow[] = [];
    // Lock one row at a time in a fixed order before reading membership or related records.
    for (const id of ids) {
      const found = await tx.$queryRaw<PersonRow[]>`
        SELECT "id", "ledgerId", "userId", "name", "deletedAt", "createdAt"
        FROM "LedgerPerson"
        WHERE "id" = ${id} AND "ledgerId" = ${ledgerId}
        FOR KEY SHARE
      `;
      if (found.length !== 1) throw this.notFound();
      rows.push(found[0]!);
    }
    return this.recordsForRows(tx, ledgerId, rows, options.allowLeft);
  }

  async lockForDelete(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    personId: string,
  ): Promise<LedgerPersonRecord> {
    const rows = await tx.$queryRaw<PersonRow[]>`
      SELECT "id", "ledgerId", "userId", "name", "deletedAt", "createdAt"
      FROM "LedgerPerson"
      WHERE "id" = ${personId} AND "ledgerId" = ${ledgerId}
      FOR UPDATE
    `;
    if (rows.length !== 1) throw this.notFound();
    const records = await this.recordsForRows(tx, ledgerId, rows, true);
    return records.get(personId)!;
  }

  async listPeople(tx: Prisma.TransactionClient, ledgerId: string): Promise<LedgerPersonRecord[]> {
    const rows = await tx.ledgerPerson.findMany({
      where: { ledgerId, OR: [{ userId: { not: null } }, { deletedAt: null }] },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const records = await this.recordsForRows(tx, ledgerId, rows, true);
    return [...records.values()];
  }

  toView(record: LedgerPersonRecord): LedgerPersonView {
    const { id, name, userId, status } = record;
    return { id, name, userId, status };
  }

  /** 列出共享帳本裡的人；個人帳本不提供這份名單。 */
  async list(ledgerId: string): Promise<LedgerPerson[]> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertSharedLedger(tx, ledgerId);
      const people = await this.listPeople(tx, ledgerId);
      return people.map((person) => this.toView(person));
    });
  }

  /** 新增非成員；唯一索引是並行請求下名稱不重複的最後防線。 */
  async createGuest(ledgerId: string, name: string): Promise<LedgerPerson> {
    const normalizedName = name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertSharedLedger(tx, ledgerId);
        const existing = await tx.ledgerPerson.findFirst({
          where: { ledgerId, userId: null, deletedAt: null, name: normalizedName },
          select: { id: true },
        });
        if (existing) throw this.nameTaken();

        const person = await tx.ledgerPerson.create({
          data: { ledgerId, userId: null, name: normalizedName },
        });
        return { id: person.id, name: person.name!, userId: null, status: 'GUEST' };
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw this.nameTaken();
      throw error;
    }
  }

  /** 改名只能作用在非成員身上；依共用鎖規則先鎖住人，再檢查名稱並寫入。 */
  async renameGuest(ledgerId: string, personId: string, name: string): Promise<LedgerPerson> {
    const normalizedName = name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.assertSharedLedger(tx, ledgerId);
        const person = await this.lockGuestTarget(tx, ledgerId, personId);
        if (person.userId !== null) throw this.memberCannotBeChanged();

        const duplicate = await tx.ledgerPerson.findFirst({
          where: {
            ledgerId,
            userId: null,
            deletedAt: null,
            name: normalizedName,
            id: { not: personId },
          },
          select: { id: true },
        });
        if (duplicate) throw this.nameTaken();

        const updated = await tx.ledgerPerson.update({
          where: { id: personId },
          data: { name: normalizedName },
        });
        return { id: updated.id, name: updated.name!, userId: null, status: 'GUEST' };
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) throw this.nameTaken();
      throw error;
    }
  }

  /** 鎖住非成員後確認沒有有效交易或結清引用，才以軟刪除釋放名字。 */
  async removeGuest(ledgerId: string, personId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.assertSharedLedger(tx, ledgerId);
      let person: LedgerPersonRecord;
      try {
        person = await this.lockForDelete(tx, ledgerId, personId);
      } catch (error) {
        if (this.isNotSelectable(error)) throw this.notFound();
        throw error;
      }
      if (person.userId !== null) throw this.memberCannotBeChanged();

      const usage = await tx.$queryRaw<Array<{ inUse: boolean }>>`
        SELECT EXISTS (
          SELECT 1
          FROM "Transaction" AS tx
          WHERE tx."ledgerId" = ${ledgerId}
            AND tx."deletedAt" IS NULL
            AND tx."payerPersonId" = ${personId}

          UNION ALL

          SELECT 1
          FROM "LedgerShare" AS share
          INNER JOIN "LedgerSplit" AS split ON split."id" = share."ledgerSplitId"
          INNER JOIN "Transaction" AS tx ON tx."id" = split."transactionId"
          WHERE share."personId" = ${personId}
            AND tx."ledgerId" = ${ledgerId}
            AND tx."deletedAt" IS NULL

          UNION ALL

          SELECT 1
          FROM "LedgerSettlement" AS settlement
          INNER JOIN "Transaction" AS tx ON tx."id" = settlement."transactionId"
          WHERE (settlement."fromPersonId" = ${personId} OR settlement."toPersonId" = ${personId})
            AND tx."ledgerId" = ${ledgerId}
            AND tx."deletedAt" IS NULL
        ) AS "inUse"
      `;
      if (usage[0]?.inUse) throw this.personInUse();

      await tx.ledgerPerson.update({
        where: { id: personId },
        data: { deletedAt: new Date() },
      });
    });
  }

  private async assertSharedLedger(tx: Prisma.TransactionClient, ledgerId: string): Promise<void> {
    const ledger = await tx.ledger.findUnique({
      where: { id: ledgerId },
      select: { kind: true },
    });
    if (!ledger || ledger.kind !== 'SHARED') throw this.ledgerNotFound();
  }

  private async lockGuestTarget(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    personId: string,
  ): Promise<LedgerPersonRecord> {
    try {
      const people = await this.lockPeople(tx, ledgerId, [personId], { allowLeft: true });
      return people.get(personId)!;
    } catch (error) {
      // 已軟刪除的非成員對管理端點而言已不存在；選擇性錯誤碼不應洩漏出來。
      if (this.isNotSelectable(error)) throw this.notFound();
      throw error;
    }
  }

  private isNotSelectable(error: unknown): boolean {
    return (
      error instanceof AppException && error.errorCode === ErrorCode.LEDGER_PERSON_NOT_SELECTABLE
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }

  private nameTaken(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.LEDGER_PERSON_NAME_TAKEN,
      'A person with this name already exists in this ledger.',
    );
  }

  private personInUse(): AppException {
    return new AppException(
      HttpStatus.CONFLICT,
      ErrorCode.LEDGER_PERSON_IN_USE,
      'This person is still used by an active transaction or settlement.',
    );
  }

  private memberCannotBeChanged(): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
      'Members cannot be renamed or deleted.',
    );
  }

  private ledgerNotFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Ledger not found.');
  }

  private async recordsForRows(
    tx: Prisma.TransactionClient,
    ledgerId: string,
    rows: PersonRow[],
    allowLeft: boolean | ReadonlySet<string>,
  ): Promise<Map<string, LedgerPersonRecord>> {
    const userIds = rows.flatMap((row) => (row.userId === null ? [] : [row.userId]));
    const [users, members] = await Promise.all([
      tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
      tx.ledgerMember.findMany({ where: { ledgerId, userId: { in: userIds } } }),
    ]);
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    const memberIds = new Set(members.map((member) => member.userId));
    const records = new Map<string, LedgerPersonRecord>();
    for (const row of rows) {
      if (row.userId === null && row.deletedAt !== null) throw this.notSelectable();
      const member = row.userId !== null && memberIds.has(row.userId);
      const leftAllowed =
        allowLeft === true || (typeof allowLeft !== 'boolean' && allowLeft.has(row.id));
      if (row.userId !== null && !member && !leftAllowed) {
        throw this.notSelectable();
      }
      records.set(
        row.id,
        this.toRecord(row, row.userId ? (userNames.get(row.userId) ?? '') : '', member),
      );
    }
    return records;
  }

  private toRecord(row: PersonRow, userName: string, member: boolean): LedgerPersonRecord {
    return {
      id: row.id,
      ledgerId: row.ledgerId,
      userId: row.userId,
      name: row.userId === null ? row.name! : userName,
      status: row.userId === null ? 'GUEST' : member ? 'MEMBER' : 'LEFT',
      createdAt: row.createdAt,
    };
  }

  private notFound(): AppException {
    return new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Person not found.');
  }

  private notSelectable(): AppException {
    return new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.LEDGER_PERSON_NOT_SELECTABLE,
      'Person cannot be selected.',
    );
  }
}
