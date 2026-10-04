import { HttpStatus, Injectable } from '@nestjs/common';
import { ErrorCode, type LedgerPerson as LedgerPersonView } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';

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
