import { INestApplication } from '@nestjs/common';
import type { Account, Category, ParseTransactionResponse, TransactionDraft } from '@ledger/shared';
import request from 'supertest';
import { LLM_PROVIDER, type LLMProvider, type LlmResponse } from '../src/ai/llm-provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2EApp, createSharedLedger, httpServer, resetDb } from './e2e-utils';
import { auth, person, type Person } from './linking-utils';

/**
 * 4a 的授權與資料隔離（spec `phase-4a-ai-text.md` SC-P9 的權限、SC-P7 的隔離部分）。
 * 協調者在實作前寫好，先看到紅燈。
 *
 * - 目前帳本的權限同新增交易：不是成員 404、退出的帳本 404、檢視者 403、封存 409。
 *   每條都配正向對照（我的帳本、我是 EDITOR 的共享帳本 200）。被拒絕時模型完全沒被呼叫，
 *   句子與清單都沒有送出去。
 * - 送給模型的清單只有我能寫入的帳本與我的非臨時帳戶，而且不含任何真的 id（決策 253）；
 *   句子只放在 user 訊息，不拼進 system 指示。
 * - 模型回的東西一律不信任（決策 240、245）：別人的帳本、看得到但不能寫的帳本、退出的帳本、
 *   原始 UUID、不存在的代號 → 帳本等於目前帳本；別人的帳戶、臨時帳戶、不在清單上的分類 →
 *   `null`；其他欄位照留。
 *
 * 策略：provider 由測試注入 stub，直接回指定的內容，不靠假 provider 的劇本。
 * stub 不知道後端給的代號，所以惡意值一律用原始 UUID 與不存在的代號；
 * 「代號對到型別不符的分類」這類需要真代號的情境，由 T1 的 `ai-parse.e2e-spec.ts` 驗。
 *
 * 場景：Bob 是使用者。Carol 擁有 4 本共享帳本：「花蓮三日」Bob 是 EDITOR、「公司聚餐」Bob 是
 * VIEWER、「去年墾丁」Bob 是 EDITOR 但已封存、「舊室友」Bob 是 EDITOR 但已退出。
 * Eve 和 Bob 沒有任何共同帳本。全部走 HTTP，只有讀臨時帳戶的 id 時直接查資料庫。
 */
describe('AI parse transaction — isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const complete = jest.fn<Promise<LlmResponse>, Parameters<LLMProvider['complete']>>();
  const stub: LLMProvider = { complete };

  beforeAll(async () => {
    ({ app, prisma } = await createE2EApp((builder) =>
      builder.overrideProvider(LLM_PROVIDER).useValue(stub),
    ));
  });
  beforeEach(async () => {
    await resetDb(prisma);
    complete.mockReset();
    complete.mockResolvedValue({ content: { drafts: [] } });
  });
  afterAll(() => app.close());

  const server = () => httpServer(app);
  const TODAY = '2026-10-21';
  const TEXT = '早餐 60';
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  const TRIP = '花蓮三日';
  const VIEWER = '公司聚餐';
  const ARCHIVED = '去年墾丁';
  const LEFT = '舊室友';
  const EVE_LEDGER = 'Eve 的私房帳';
  const EVE_ACCOUNT = 'Eve 的薪轉戶';

  interface Scene {
    bob: Person;
    carol: Person;
    eve: Person;
    tripId: string;
    viewerId: string;
    archivedId: string;
    leftId: string;
    eveSharedId: string;
    eveAccountId: string;
    bobTemporaryId: string;
  }

  async function addMember(owner: Person, ledgerId: string, member: Person, role: string) {
    await request(server())
      .post(`/api/ledgers/${ledgerId}/members`)
      .set(auth(owner.token))
      .send({ email: member.email, role })
      .expect(201);
  }

  async function scene(): Promise<Scene> {
    const bob = await person(app, 'bob@example.com', 'Bob');
    const carol = await person(app, 'carol@example.com', 'Carol');
    const eve = await person(app, 'eve@example.com', 'Eve');

    const tripId = await createSharedLedger(app, carol.token, TRIP);
    const viewerId = await createSharedLedger(app, carol.token, VIEWER);
    const archivedId = await createSharedLedger(app, carol.token, ARCHIVED);
    const leftId = await createSharedLedger(app, carol.token, LEFT);
    await addMember(carol, tripId, bob, 'EDITOR');
    await addMember(carol, viewerId, bob, 'VIEWER');
    await addMember(carol, archivedId, bob, 'EDITOR');
    await addMember(carol, leftId, bob, 'EDITOR');

    await request(server())
      .post(`/api/ledgers/${archivedId}/archive`)
      .set(auth(carol.token))
      .expect(201);
    // Bob 在「舊室友」沒有任何帳，不用合併就能退出。
    await request(server())
      .post(`/api/ledgers/${leftId}/leave`)
      .set(auth(bob.token))
      .send({ targetLedgerId: null, excludedItemIds: [] })
      .expect(204);

    const eveSharedId = await createSharedLedger(app, eve.token, EVE_LEDGER);
    const eveAccount = await request(server())
      .post('/api/accounts')
      .set(auth(eve.token))
      .send({ name: EVE_ACCOUNT, initialBalance: 0 })
      .expect(201);

    const bobTemporary = await prisma.account.findFirstOrThrow({
      where: { userId: bob.userId, isTemporary: true },
    });

    return {
      bob,
      carol,
      eve,
      tripId,
      viewerId,
      archivedId,
      leftId,
      eveSharedId,
      eveAccountId: (eveAccount.body as Account).id,
      bobTemporaryId: bobTemporary.id,
    };
  }

  function parse(who: Person, ledgerId: string, text = TEXT) {
    return request(server())
      .post('/api/ai/parse-transaction')
      .set(auth(who.token))
      .send({ text, ledgerId, today: TODAY });
  }

  async function expenseCategoryId(who: Person, ledgerId: string): Promise<string> {
    const res = await request(server())
      .get(`/api/ledgers/${ledgerId}/categories`)
      .query({ type: 'EXPENSE' })
      .set(auth(who.token))
      .expect(200);
    return (res.body as Category[])[0]!.id;
  }

  describe('SC-P9: the current ledger must be writable, and nothing reaches the model otherwise', () => {
    it('allows my own ledger and a shared ledger where I am EDITOR (positive control)', async () => {
      const s = await scene();

      for (const ledgerId of [s.bob.ledgerId, s.tripId]) {
        const res = await parse(s.bob, ledgerId).expect(200);
        expect(res.body).toEqual({ drafts: [] });
      }
      expect(complete).toHaveBeenCalledTimes(2);
    });

    it.each([
      ['someone else’s ledger', (s: Scene) => s.eve.ledgerId, 404, 'NOT_FOUND'],
      ['someone else’s shared ledger', (s: Scene) => s.eveSharedId, 404, 'NOT_FOUND'],
      ['a ledger I have left', (s: Scene) => s.leftId, 404, 'NOT_FOUND'],
      [
        'a ledger that does not exist',
        () => '00000000-0000-4000-8000-000000000000',
        404,
        'NOT_FOUND',
      ],
      ['a ledger where I am VIEWER', (s: Scene) => s.viewerId, 403, 'FORBIDDEN'],
      ['an archived ledger', (s: Scene) => s.archivedId, 409, 'LEDGER_ARCHIVED'],
    ] as const)('rejects %s before calling the model', async (_label, ledgerOf, status, code) => {
      const s = await scene();

      const res = await parse(s.bob, ledgerOf(s)).expect(status);

      expect((res.body as { errorCode: string }).errorCode).toBe(code);
      expect(complete).not.toHaveBeenCalled();
    });
  });

  describe('decision 253: what is sent to the model', () => {
    it('lists only writable ledgers and my real accounts, without ids, and keeps the sentence out of system', async () => {
      const s = await scene();

      await parse(s.bob, s.bob.ledgerId).expect(200);

      expect(complete).toHaveBeenCalledTimes(1);
      const { system, user } = complete.mock.calls[0]![0];
      expect(user).toBe(TEXT);
      // 正向對照：可寫入的共享帳本有送出，下面的「不含」才有意義。
      expect(system).toContain(TRIP);
      for (const forbidden of [VIEWER, ARCHIVED, LEFT, EVE_LEDGER, EVE_ACCOUNT, TEXT]) {
        expect(system).not.toContain(forbidden);
      }
      expect(system).not.toMatch(UUID);
    });

    it('trims the sentence before sending it', async () => {
      const s = await scene();

      await parse(s.bob, s.bob.ledgerId, `  ${TEXT}  `).expect(200);

      expect(complete.mock.calls[0]![0].user).toBe(TEXT);
    });
  });

  describe('SC-P7: nothing the model returns can point outside what I can write', () => {
    it('falls back to the current ledger and clears foreign accounts and categories', async () => {
      const s = await scene();
      const bobOwnCategoryId = await expenseCategoryId(s.bob, s.bob.ledgerId);
      const viewerCategoryId = await expenseCategoryId(s.carol, s.viewerId);
      const bobCashId = s.bob.cashId;
      const draft = (overrides: Record<string, unknown>) => ({
        type: 'EXPENSE',
        ledger: null,
        amountYuan: '60',
        date: '2026-10-20',
        title: '早餐',
        category: null,
        account: null,
        toAccount: null,
        ...overrides,
      });
      complete.mockResolvedValueOnce({
        content: {
          drafts: [
            // 1. 別人的帳本、別人看得到但我不能寫的帳本的分類、別人的帳戶，全用原始 UUID。
            draft({ ledger: s.eve.ledgerId, category: viewerCategoryId, account: s.eveAccountId }),
            // 2. 我看得到但不能寫的帳本、我的臨時帳戶。
            draft({ ledger: s.viewerId, title: '午餐', account: s.bobTemporaryId }),
            // 3. 封存的帳本；我自己的分類與帳戶，但給的是原始 UUID 不是代號。
            draft({
              ledger: s.archivedId,
              title: '晚餐',
              category: bobOwnCategoryId,
              account: bobCashId,
            }),
            // 4. 退出的帳本；轉帳兩邊都是不該出現的帳戶。
            draft({
              type: 'TRANSFER',
              ledger: s.leftId,
              title: '轉帳',
              account: s.bobTemporaryId,
              toAccount: s.eveAccountId,
            }),
            // 5. 不存在的代號；負數金額、不存在的日期。
            draft({
              ledger: 'L999',
              title: '計程車',
              amountYuan: '-5',
              date: '2026-02-30',
              category: 'C999',
              account: 'A999',
            }),
          ],
        },
      });

      const res = await parse(s.bob, s.bob.ledgerId).expect(200);

      const expected = (overrides: Partial<TransactionDraft>): TransactionDraft => ({
        ledgerId: s.bob.ledgerId,
        type: 'EXPENSE',
        amount: 6000,
        date: '2026-10-20',
        title: '早餐',
        categoryId: null,
        accountId: null,
        toAccountId: null,
        ...overrides,
      });
      expect((res.body as ParseTransactionResponse).drafts).toEqual([
        expected({}),
        expected({ title: '午餐' }),
        expected({ title: '晚餐' }),
        expected({ type: 'TRANSFER', title: '轉帳' }),
        expected({ title: '計程車', amount: null, date: null }),
      ]);
    });

    it('rejects raw ids even for my own ledger, category and account', async () => {
      const s = await scene();
      // 目前帳本是「花蓮三日」，模型回 Bob 私人帳本的原始 UUID：一樣不接受，留在目前帳本。
      complete.mockResolvedValueOnce({
        content: {
          drafts: [
            {
              type: 'EXPENSE',
              ledger: s.bob.ledgerId,
              amountYuan: '120',
              date: null,
              title: null,
              category: await expenseCategoryId(s.bob, s.bob.ledgerId),
              account: s.bob.cashId,
              toAccount: null,
            },
          ],
        },
      });

      const res = await parse(s.bob, s.tripId).expect(200);

      const [only] = (res.body as ParseTransactionResponse).drafts;
      expect(only).toMatchObject({
        ledgerId: s.tripId,
        amount: 12000,
        date: TODAY,
        categoryId: null,
        accountId: null,
      });
    });
  });
});
