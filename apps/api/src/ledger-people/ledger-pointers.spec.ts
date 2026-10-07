import { Prisma } from '../generated/prisma/client';
import { loadEffectivePointers } from './ledger-pointers';

/** 批次載入同時驗證自動連動、明確改指與明確 null；查詢數量不隨人數增加。 */
describe('loadEffectivePointers', () => {
  it('resolves automatic and explicit pointers with three batched queries', async () => {
    const findPeople = jest.fn().mockResolvedValue([
      { id: 'bob', userId: 'bob-user' },
      { id: 'guest', userId: null },
      { id: 'carol', userId: 'carol-user' },
      { id: 'stranger', userId: 'stranger-user' },
      { id: 'me', userId: 'me-user' },
    ]);
    const findExplicit = jest.fn().mockResolvedValue([
      { ledgerPersonId: 'guest', counterpartyId: 'manual' },
      { ledgerPersonId: 'carol', counterpartyId: null },
    ]);
    const findLinks = jest.fn().mockResolvedValue([
      {
        userLowId: 'me-user',
        userHighId: 'bob-user',
        counterpartyLowId: 'linked-bob',
        counterpartyHighId: 'their-side',
      },
    ]);
    const client = {
      ledgerPerson: { findMany: findPeople },
      ledgerPersonPointer: { findMany: findExplicit },
      counterpartyLink: { findMany: findLinks },
    } as unknown as Pick<
      Prisma.TransactionClient,
      'ledgerPerson' | 'ledgerPersonPointer' | 'counterpartyLink'
    >;

    const pointers = await loadEffectivePointers(client, 'me-user', [
      'bob',
      'guest',
      'carol',
      'stranger',
      'me',
    ]);
    expect(pointers.get('bob')).toEqual({ counterpartyId: 'linked-bob', auto: true });
    expect(pointers.get('guest')).toEqual({ counterpartyId: 'manual', auto: false });
    expect(pointers.get('carol')).toEqual({ counterpartyId: null, auto: false });
    expect(pointers.get('stranger')).toEqual({ counterpartyId: null, auto: true });
    expect(pointers.has('me')).toBe(false);
    expect(findPeople).toHaveBeenCalledTimes(1);
    expect(findExplicit).toHaveBeenCalledTimes(1);
    expect(findLinks).toHaveBeenCalledTimes(1);
  });
});
