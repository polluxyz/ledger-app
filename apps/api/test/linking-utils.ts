import { INestApplication } from '@nestjs/common';
import type { Counterparty, DebtProposal, FriendRequest, Paginated } from '@ledger/shared';
import request from 'supertest';
import { firstAccountId, firstLedgerId, httpServer, registerAndLogin } from './e2e-utils';

/**
 * 3b-2 連動 e2e 的共用工具：建立一個人、把兩個人連動起來、讀提議。
 *
 * 連動一律走真正的 HTTP 流程（A 從對象用 email 邀請 → B 在收到的邀請裡接受），
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
 * 把 A 的「aName」與 B 的「bName」連動起來，回傳雙方的對象 id。
 * A 用 email 邀請、B 接受並新建對象。
 */
export async function linkPair(
  app: INestApplication,
  a: Person,
  b: Person,
  aName = '小明',
  bName = '阿A',
): Promise<{ aCounterpartyId: string; bCounterpartyId: string }> {
  const aCounterparty = await createCounterparty(app, a, aName);
  await request(httpServer(app))
    .post(`/api/counterparties/${aCounterparty.id}/link-invites`)
    .set(auth(a.token))
    .send({ email: b.email })
    .expect(201);
  const invite = await pendingIncomingRequest(app, b);
  await request(httpServer(app))
    .post(`/api/friend-requests/${invite.id}/accept`)
    .set(auth(b.token))
    .send({ counterparty: { name: bName } })
    .expect(200);

  const bList = await request(httpServer(app))
    .get('/api/counterparties')
    .query({ q: bName })
    .set(auth(b.token))
    .expect(200);
  const bCounterparty = (bList.body as Paginated<Counterparty>).items.find(
    (item) => item.name === bName,
  )!;
  return { aCounterpartyId: aCounterparty.id, bCounterpartyId: bCounterparty.id };
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
