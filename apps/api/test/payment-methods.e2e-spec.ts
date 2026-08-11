import { INestApplication } from '@nestjs/common';
import { PaymentMethod } from '@ledger/shared';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, firstLedgerId, httpServer, registerAndLogin, resetDb } from './e2e-utils';

/**
 * 付款方式的 e2e：新帳本自帶預設付款方式、EDITOR 才能寫入、同帳本名稱唯一、
 * 有交易引用時不可刪、跨帳本存取回 404。對照 spec §2 的 SC-A1～SC-A4、SC-A6。
 */
describe('Payment methods (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp());
  });
  beforeEach(() => resetDb(prisma));
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('seeds a new ledger with the default payment methods', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(alice.token));

    expect(res.status).toBe(200);
    const names = (res.body as PaymentMethod[]).map((pm) => pm.name);
    expect(names).toEqual(['現金', '信用卡', '銀行轉帳', '行動支付']);
  });

  it('lets an editor create one and rejects a duplicate name with 409', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const created = await request(server())
      .post(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(alice.token))
      .send({ name: '悠遊卡' });
    expect(created.status).toBe(201);
    expect((created.body as PaymentMethod).name).toBe('悠遊卡');

    const dup = await request(server())
      .post(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(alice.token))
      .send({ name: '悠遊卡' });
    expect(dup.status).toBe(409);
    expect((dup.body as { errorCode: string }).errorCode).toBe('PAYMENT_METHOD_NAME_TAKEN');
  });

  it('forbids a viewer from writing (403)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const ledgerId = await firstLedgerId(app, alice.token);

    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(alice.token))
      .send({ email: 'bob@example.com', role: 'VIEWER' });

    const denied = await request(server())
      .post(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(bob.token))
      .send({ name: '禮券' });
    expect(denied.status).toBe(403);

    // 但 viewer 讀得到。
    const list = await request(server())
      .get(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(bob.token));
    expect(list.status).toBe(200);
  });

  it('blocks deleting a payment method a transaction references (409)', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const ledgerId = await firstLedgerId(app, alice.token);

    const pms = await request(server())
      .get(`/api/ledgers/${ledgerId}/payment-methods`)
      .set(auth(alice.token));
    const paymentMethodId = (pms.body as PaymentMethod[])[0]!.id;

    const categories = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories?type=EXPENSE`)
      .set(auth(alice.token));
    const categoryId = (categories.body as Array<{ id: string }>)[0]!.id;

    await request(server())
      .post(`/api/ledgers/${ledgerId}/transactions`)
      .set(auth(alice.token))
      .send({
        type: 'EXPENSE',
        amount: 100,
        date: '2026-08-11T12:00:00.000Z',
        categoryId,
        paymentMethodId,
      });

    const blocked = await request(server())
      .delete(`/api/ledgers/${ledgerId}/payment-methods/${paymentMethodId}`)
      .set(auth(alice.token));
    expect(blocked.status).toBe(409);
    expect((blocked.body as { errorCode: string }).errorCode).toBe('PAYMENT_METHOD_IN_USE');

    // 未被引用的那個可以刪。
    const unused = (pms.body as PaymentMethod[])[1]!.id;
    const deleted = await request(server())
      .delete(`/api/ledgers/${ledgerId}/payment-methods/${unused}`)
      .set(auth(alice.token));
    expect(deleted.status).toBe(204);
  });

  it('hides another ledger payment methods behind a 404', async () => {
    const alice = await registerAndLogin(app, 'alice@example.com', 'Alice');
    const bob = await registerAndLogin(app, 'bob@example.com', 'Bob');
    const aliceLedger = await firstLedgerId(app, alice.token);
    const bobLedger = await firstLedgerId(app, bob.token);

    const alicePms = await request(server())
      .get(`/api/ledgers/${aliceLedger}/payment-methods`)
      .set(auth(alice.token));
    const alicePmId = (alicePms.body as PaymentMethod[])[0]!.id;

    // Bob 在自己的帳本裡，用 Alice 帳本的付款方式 id 改名 → 404。
    const res = await request(server())
      .patch(`/api/ledgers/${bobLedger}/payment-methods/${alicePmId}`)
      .set(auth(bob.token))
      .send({ name: 'Hacked' });
    expect(res.status).toBe(404);
  });
});
