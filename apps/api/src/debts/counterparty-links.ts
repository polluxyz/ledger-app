import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import type { CounterpartyLinkInfo } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';
import { Prisma } from '../generated/prisma/client';
import { areFriends, createFriendship, orderPair } from '../friends/friendship';
import { lockCounterparty } from './debt-entry-rules';

/** 未來若加刪除帳號，連動會被 cascade 刪掉；刪除前要先照決策 78 替 `name = null` 的對象補名字。 */

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
 * - **解除會替空暱稱補名字**：對象與往來紀錄保留，避免失去連動後顯示名稱消失（決策 78）。
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
 * 接受邀請時，在呼叫端的交易裡建立好友、雙方空暱稱對象與連動（決策 73～75）。
 * 先數各自未連動的舊對象，才知道哪一側需要詢問合併；任何一步失敗，邀請仍可接受。
 * 唯一索引是同時接受的最後防線（`P2002` → `ALREADY_LINKED`）。
 */
export async function establishLink(
  tx: Prisma.TransactionClient,
  input: { inviterId: string; accepterId: string },
): Promise<{ counterpartyId: string; askMerge: boolean }> {
  const { inviterId, accepterId } = input;
  if ((await findLinkBetween(tx, inviterId, accepterId)) !== null) throw alreadyLinked();

  // 在新增對象前判斷，避免新建立的對象把自己算進「舊紀錄待合併」。
  const [inviterOld, accepterOld] = await Promise.all([
    tx.counterparty.count({
      where: { ownerId: inviterId, linkAsLow: null, linkAsHigh: null },
    }),
    tx.counterparty.count({
      where: { ownerId: accepterId, linkAsLow: null, linkAsHigh: null },
    }),
  ]);
  if (!(await areFriends(tx, inviterId, accepterId))) {
    await createFriendship(tx, inviterId, accepterId);
  }
  const inviter = await tx.counterparty.create({
    data: { ownerId: inviterId, name: null, askMerge: inviterOld > 0 },
  });
  const accepter = await tx.counterparty.create({
    data: { ownerId: accepterId, name: null, askMerge: accepterOld > 0 },
  });
  const pair = orderPair(inviterId, accepterId);
  try {
    await tx.counterpartyLink.create({
      data: {
        ...pair,
        counterpartyLowId: pair.userLowId === inviterId ? inviter.id : accepter.id,
        counterpartyHighId: pair.userLowId === inviterId ? accepter.id : inviter.id,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw alreadyLinked();
    }
    throw error;
  }
  return { counterpartyId: accepter.id, askMerge: accepter.askMerge };
}

/**
 * 解除兩位使用者之間的連動（決策 70、71、78）。回傳解除前是否有連動、是否是好友。
 *
 * 一次做完四件事，必須在同一個資料庫交易裡——只做一半的話，會留下「好友已解除但還連著」
 * 或「連動已刪但紀錄還互相配對」這種畫面上看不到、之後卻會出錯的狀態：
 * 1. 刪掉連動。
 * 2. 刪掉好友關係（畫面上沒有好友，留著只會讓下次邀請時出現怪錯誤）。
 * 3. 清空雙方對象底下所有紀錄的配對。
 * 4. 雙方之間待確認的提議與邀請改成 `CANCELLED`。
 * 5. 空暱稱改成對方此刻的帳號名稱；撞名時依序加 2、3，讓解除後仍有固定的顯示名稱。
 */
export async function unlinkUsers(
  tx: Prisma.TransactionClient,
  a: string,
  b: string,
  now: Date,
): Promise<{ wasLinked: boolean; wereFriends: boolean }> {
  const link = await findLinkBetween(tx, a, b);
  if (link !== null) {
    // 解除後 null 暱稱失去帳號名稱來源；先鎖住兩側並補固定名字。
    for (const id of [link.counterpartyLowId, link.counterpartyHighId].sort()) {
      await lockCounterparty(tx, id);
    }
    const users = await tx.user.findMany({
      where: { id: { in: [link.userLowId, link.userHighId] } },
      select: { id: true, name: true },
    });
    const userNames = new Map(users.map((user) => [user.id, user.name]));
    await restoreName(tx, link.counterpartyLowId, link.userLowId, userNames.get(link.userHighId)!);
    await restoreName(tx, link.counterpartyHighId, link.userHighId, userNames.get(link.userLowId)!);
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
      OR: [
        { requesterId: a, recipientId: b },
        { requesterId: b, recipientId: a },
      ],
    },
    data: { status: 'CANCELLED', respondedAt: now },
  });

  return { wasLinked: link !== null, wereFriends: friendship.count > 0 };
}

/** 同名已被舊對象使用時加數字，保住使用者原有的名字。 */
async function restoreName(
  tx: Prisma.TransactionClient,
  id: string,
  ownerId: string,
  base: string,
): Promise<void> {
  const row = await tx.counterparty.findUniqueOrThrow({ where: { id } });
  if (row.name !== null) return;
  // 帳號名稱註冊時只限長度、沒去空白；對象名字的 CHECK 要求去過空白且非空，
  // 直接照抄會讓整個解除連動失敗。去空白後是空字串就用「對方」。
  const trimmed = base.trim().slice(0, 100);
  const root = trimmed === '' ? '對方' : trimmed;
  let name = root;
  for (let suffix = 2; await tx.counterparty.findFirst({ where: { ownerId, name } }); suffix++) {
    const appendix = ` ${suffix}`;
    name = `${root.slice(0, 100 - appendix.length).trimEnd()}${appendix}`;
  }
  await tx.counterparty.update({ where: { id }, data: { name } });
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

export function alreadyLinked(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.ALREADY_LINKED,
    'You are already linked with this person.',
  );
}

export function counterpartyLinked(): AppException {
  return new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.COUNTERPARTY_LINKED,
    'This counterparty is linked; unlink it first.',
  );
}
