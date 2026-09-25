import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { CounterpartyLinkInfo, LinkCounterpartyChoice } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { areFriends, createFriendship, orderPair } from '../friends/friendship';
import { badRequest, notFound } from './debt-entry-rules';

/**
 * 往來帳連動（spec 3b-2）的共用讀寫函式：建立連動、解除連動、讀出對方那一側。
 *
 * 好友端點（接受連動邀請、解除好友）與往來帳端點（解除連動、讀對象）都會碰連動，
 * **一律經過這裡**。寫法沿用 `friendship.ts`：純函式、吃 `tx`，不是 service——
 * 這樣 `FriendsModule` 與 `DebtsModule` 不必互相注入。
 *
 * 兩條貫穿全檔的規則：
 * - **一對使用者只存一筆** `CounterpartyLink`，id 小的使用者與他的對象放 low 那一側
 *   （同 `Friendship`）。資料庫的 CHECK `CounterpartyLink_ordered` 是最後防線。
 * - **解除只刪連動本身**：對象、名字、往來紀錄全部保留（決策 71）。
 */

type LinkRow = Prisma.CounterpartyLinkGetPayload<object>;

/** 連動的另一側：對方是誰、他那邊的對象是哪一個。 */
export interface LinkOtherSide {
  userId: string;
  counterpartyId: string;
}

/** 一個對象所在的連動；沒有連動回 `null`。 */
export async function findLinkOfCounterparty(
  client: Pick<Prisma.TransactionClient, 'counterpartyLink'>,
  counterpartyId: string,
): Promise<LinkRow | null> {
  return client.counterpartyLink.findFirst({
    where: {
      OR: [{ counterpartyLowId: counterpartyId }, { counterpartyHighId: counterpartyId }],
    },
  });
}

/** 從某個對象的角度，取出連動的另一側。 */
export function otherSide(link: LinkRow, counterpartyId: string): LinkOtherSide {
  return link.counterpartyLowId === counterpartyId
    ? { userId: link.userHighId, counterpartyId: link.counterpartyHighId }
    : { userId: link.userLowId, counterpartyId: link.counterpartyLowId };
}

/** 從某位使用者的角度，取出他在這個連動裡的對象。 */
export function ownSideCounterparty(link: LinkRow, userId: string): string {
  return link.userLowId === userId ? link.counterpartyLowId : link.counterpartyHighId;
}

/** 兩位使用者之間的連動；沒有回 `null`。 */
export async function findLinkBetween(
  client: Pick<Prisma.TransactionClient, 'counterpartyLink'>,
  a: string,
  b: string,
): Promise<LinkRow | null> {
  return client.counterpartyLink.findUnique({
    where: { userLowId_userHighId: orderPair(a, b) },
  });
}

/**
 * 接受連動邀請時建立連動（決策 56～58）。在呼叫端的資料庫交易裡執行，任何一步失敗整筆回滾，
 * 邀請不被消耗。回傳接受者這邊接上的對象 id。
 *
 * 檢查順序是錯誤的優先順序：
 * 1. 這對使用者已經連動、或發起者的對象已經連到別人 → `ALREADY_LINKED`。邀請送出後，
 *    發起者可能已經用別的方式連上了。
 * 2. 接受者選的對象：`{ id }` 必須是自己的（否則 404）且未連動（`COUNTERPARTY_LINKED`）；
 *    `{ name }` 新建，撞名 `COUNTERPARTY_NAME_TAKEN`。
 * 3. 還不是好友就成為好友（已經是好友也可以連動）。
 * 4. 建立連動。唯一索引擋下同時送達的第二次（`P2002` → `ALREADY_LINKED`）。
 */
export async function establishLink(
  tx: Prisma.TransactionClient,
  input: {
    inviterId: string;
    inviterCounterpartyId: string;
    accepterId: string;
    choice: LinkCounterpartyChoice;
  },
): Promise<string> {
  const { inviterId, inviterCounterpartyId, accepterId, choice } = input;

  if (
    (await findLinkBetween(tx, inviterId, accepterId)) !== null ||
    (await findLinkOfCounterparty(tx, inviterCounterpartyId)) !== null
  ) {
    throw alreadyLinked();
  }

  const accepterCounterpartyId = await resolveAccepterCounterparty(tx, accepterId, choice);

  if (!(await areFriends(tx, inviterId, accepterId))) {
    await createFriendship(tx, inviterId, accepterId);
  }

  const inviterIsLow = orderPair(inviterId, accepterId).userLowId === inviterId;
  try {
    await tx.counterpartyLink.create({
      data: {
        ...orderPair(inviterId, accepterId),
        counterpartyLowId: inviterIsLow ? inviterCounterpartyId : accepterCounterpartyId,
        counterpartyHighId: inviterIsLow ? accepterCounterpartyId : inviterCounterpartyId,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw alreadyLinked();
    }
    throw error;
  }
  return accepterCounterpartyId;
}

async function resolveAccepterCounterparty(
  tx: Prisma.TransactionClient,
  accepterId: string,
  choice: LinkCounterpartyChoice,
): Promise<string> {
  if ('id' in choice) {
    const row = await tx.counterparty.findFirst({
      where: { id: choice.id, ownerId: accepterId },
      select: { id: true },
    });
    if (row === null) {
      throw notFound('Counterparty');
    }
    if ((await findLinkOfCounterparty(tx, row.id)) !== null) {
      throw counterpartyLinked();
    }
    return row.id;
  }

  // 用 create 而不是 upsert：接受者輸入的名字若已經存在，可能是另一個人，
  // 系統不能替他猜「就是這一個」。要接既有的對象就用 `{ id }`。
  try {
    const created = await tx.counterparty.create({
      data: { ownerId: accepterId, name: choice.name },
      select: { id: true },
    });
    return created.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppException(
        HttpStatus.CONFLICT,
        ErrorCode.COUNTERPARTY_NAME_TAKEN,
        'You already have a counterparty with this name.',
      );
    }
    throw error;
  }
}

/**
 * 解除兩位使用者之間的連動（決策 70、71）。回傳解除前是否有連動、是否是好友；兩者都沒有就什麼都沒改。
 *
 * 一次做完四件事，必須在同一個資料庫交易裡——只做一半的話，會留下「好友已解除但還連著」
 * 或「連動已刪但紀錄還互相配對」這種畫面上看不到、之後卻會出錯的狀態：
 * 1. 刪掉連動。
 * 2. 刪掉好友關係（畫面上沒有好友，留著只會讓下次邀請時出現怪錯誤）。
 * 3. 清空雙方對象底下所有紀錄的配對。
 * 4. 雙方之間待確認的提議與連動邀請改成 `CANCELLED`。
 *
 * 對象、名字、往來紀錄都不動。
 */
export async function unlinkUsers(
  tx: Prisma.TransactionClient,
  a: string,
  b: string,
  now: Date,
): Promise<{ wasLinked: boolean; wereFriends: boolean }> {
  const link = await findLinkBetween(tx, a, b);
  if (link !== null) {
    await tx.counterpartyLink.delete({ where: { id: link.id } });
    await tx.debtEntry.updateMany({
      where: {
        counterpartyId: { in: [link.counterpartyLowId, link.counterpartyHighId] },
        pairedEntryId: { not: null },
      },
      data: { pairedEntryId: null },
    });
  }

  const friendship = await tx.friendship.deleteMany({ where: orderPair(a, b) });

  const pair = [
    { fromUserId: a, toUserId: b },
    { fromUserId: b, toUserId: a },
  ];
  await tx.debtProposal.updateMany({
    where: { status: 'PENDING', OR: pair },
    data: { status: 'CANCELLED', respondedAt: now },
  });
  await tx.friendRequest.updateMany({
    where: {
      status: 'PENDING',
      counterpartyId: { not: null },
      OR: [
        { requesterId: a, recipientId: b },
        { requesterId: b, recipientId: a },
      ],
    },
    data: { status: 'CANCELLED', respondedAt: now },
  });

  return { wasLinked: link !== null, wereFriends: friendship.count > 0 };
}

/**
 * 一批對象的連動資訊（決策 60）。`theirBalance` 是對方那一側對象的往來餘額**取負號**：
 * 對方帳上「我欠他 100」（−100），換成我的角度就是「他欠我 100」（+100）。
 *
 * 對方那一側的對象 id 只在這裡用來算餘額，不會出現在回應裡。
 */
export async function linkInfoFor(
  client: Pick<Prisma.TransactionClient, 'counterpartyLink' | 'debtEntry'>,
  counterpartyIds: string[],
): Promise<Map<string, CounterpartyLinkInfo>> {
  if (counterpartyIds.length === 0) {
    return new Map();
  }
  const links = await client.counterpartyLink.findMany({
    where: {
      OR: [
        { counterpartyLowId: { in: counterpartyIds } },
        { counterpartyHighId: { in: counterpartyIds } },
      ],
    },
    include: {
      userLow: { select: { id: true, name: true } },
      userHigh: { select: { id: true, name: true } },
    },
  });
  if (links.length === 0) {
    return new Map();
  }

  const mine = new Set(counterpartyIds);
  const pairs = links.map((link) => {
    const lowIsMine = mine.has(link.counterpartyLowId);
    return {
      mineId: lowIsMine ? link.counterpartyLowId : link.counterpartyHighId,
      theirsId: lowIsMine ? link.counterpartyHighId : link.counterpartyLowId,
      other: lowIsMine ? link.userHigh : link.userLow,
    };
  });

  const sums = await client.debtEntry.groupBy({
    by: ['counterpartyId'],
    where: { deletedAt: null, counterpartyId: { in: pairs.map((pair) => pair.theirsId) } },
    _sum: { delta: true },
  });
  const theirBalances = new Map(sums.map((sum) => [sum.counterpartyId, sum._sum.delta ?? 0]));

  return new Map(
    pairs.map((pair) => [
      pair.mineId,
      {
        userId: pair.other.id,
        userName: pair.other.name,
        // `|| 0` 把 -0 收成 0：JSON 會把 -0 輸出成 0，但單元測試的 toEqual 分得出來。
        theirBalance: -(theirBalances.get(pair.theirsId) ?? 0) || 0,
      },
    ]),
  );
}

/** 接受連動邀請的 `counterparty` 必須恰好是 `{ id }` 或 `{ name }` 其中一個。 */
export function assertLinkChoice(
  choice: { id?: string; name?: string } | undefined,
): LinkCounterpartyChoice {
  if (choice === undefined) {
    throw badRequest('counterparty is required to accept a link invite.');
  }
  const hasId = choice.id !== undefined;
  const hasName = choice.name !== undefined;
  if (hasId === hasName) {
    throw badRequest('counterparty needs exactly one of id or name.');
  }
  return hasId ? { id: choice.id! } : { name: choice.name! };
}

export function alreadyLinked(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.ALREADY_LINKED,
    'You are already linked with this person, or this counterparty is linked to someone else.',
  );
}

export function counterpartyLinked(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.COUNTERPARTY_LINKED,
    'This counterparty is linked; unlink it first.',
  );
}
