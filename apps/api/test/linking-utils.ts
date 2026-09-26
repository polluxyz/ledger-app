import { INestApplication } from '@nestjs/common';
import type {
  Counterparty,
  DebtProposal,
  FriendRequest,
  LinkAccepted,
  Paginated,
} from '@ledger/shared';
import request from 'supertest';
import { firstAccountId, firstLedgerId, httpServer, registerAndLogin } from './e2e-utils';

/**
 * 3b-2 連動 e2e 的共用工具：建立一個人、把兩個人連動起來、讀提議。
 *
 * 連動一律走真正的 HTTP 流程（A 用 email 邀請 → B 在收到的邀請裡接受），
 * 不直接寫資料庫——測試驗的就是這條路徑本身。
 */

export const DAY = '2026-09-25T12:00:00.000Z';

export interface Person {
  token: string;
  userId: string;
  email: string;
  ledgerId: string;
  cashId: string;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function person(app: INestApplication, email: string, name: string): Promise<Person> {
  const user = await registerAndLogin(app, email, name);
  return {
    ...user,
    email,
    ledgerId: await firstLedgerId(app, user.token),
    cashId: await firstAccountId(app, user.token),
  };
}

export async function createCounterparty(
  app: INestApplication,
  who: Person,
  name: string,
): Promise<Counterparty> {
  const res = await request(httpServer(app))
    .post('/api/counterparties')
    .set(auth(who.token))
    .send({ name })
    .expect(201);
  return res.body as Counterparty;
}

/** 收件者收到、還在等待的第一筆邀請。 */
export async function pendingIncomingRequest(
  app: INestApplication,
  who: Person,
): Promise<FriendRequest> {
  const res = await request(httpServer(app))
    .get('/api/friend-requests')
    .query({ direction: 'incoming', status: 'PENDING' })
    .set(auth(who.token))
    .expect(200);
  return (res.body as Paginated<FriendRequest>).items[0]!;
}

/**
 * 把 A 與 B 連動起來，回傳雙方的對象 id（3b-2 修訂 1 的流程）。
 *
 * A 用 email 邀請（不綁人，決策 73）→ B 接受（不帶 body，決策 74）→ 雙方各自多一個已連動、
 * 沒有名字的對象。為了讓既有測試照舊用「小明」「阿A」辨認，最後替雙方各設一個暱稱；
 * 傳 `null` 就不設，保留「沒有暱稱」的狀態。
 */
export async function linkPair(
  app: INestApplication,
  a: Person,
  b: Person,
  aName: string | null = '小明',
  bName: string | null = '阿A',
): Promise<{ aCounterpartyId: string; bCounterpartyId: string; accepted: LinkAccepted }> {
  await request(httpServer(app))
    .post('/api/friend-requests')
    .set(auth(a.token))
    .send({ email: b.email })
    .expect(201);
  const invite = await pendingIncomingRequest(app, b);
  const acceptRes = await request(httpServer(app))
    .post(`/api/friend-requests/${invite.id}/accept`)
    .set(auth(b.token))
    .expect(200);
  const accepted = acceptRes.body as LinkAccepted;

  const aList = await request(httpServer(app))
    .get('/api/counterparties')
    .query({ limit: 100 })
    .set(auth(a.token))
    .expect(200);
  const aCounterparty = (aList.body as Paginated<Counterparty>).items.find(
    (item) => item.link?.userId === b.userId,
  )!;

  for (const [who, id, name] of [
    [a, aCounterparty.id, aName],
    [b, accepted.counterpartyId, bName],
  ] as const) {
    if (name !== null) {
      await request(httpServer(app))
        .patch(`/api/counterparties/${id}`)
        .set(auth(who.token))
        .send({ name })
        .expect(200);
    }
  }
  return { aCounterpartyId: aCounterparty.id, bCounterpartyId: accepted.counterpartyId, accepted };
}

export async function proposals(
  app: INestApplication,
  who: Person,
  direction: 'incoming' | 'outgoing',
  status?: string,
): Promise<DebtProposal[]> {
  const res = await request(httpServer(app))
    .get('/api/debt-proposals')
    .query({ direction, ...(status ? { status } : {}) })
    .set(auth(who.token))
    .expect(200);
  return (res.body as Paginated<DebtProposal>).items;
}

export async function getCounterparty(
  app: INestApplication,
  who: Person,
  counterpartyId: string,
): Promise<Counterparty> {
  const res = await request(httpServer(app))
    .get(`/api/counterparties/${counterpartyId}`)
    .set(auth(who.token))
    .expect(200);
  return res.body as Counterparty;
}
