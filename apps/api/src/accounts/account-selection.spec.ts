import { assertSelectableAccount, temporaryAccountIdOf } from './account-selection';

/**
 * 帳戶 id 的共用檢查（3h 決策 169）。所有收帳戶的入口都靠它，所以這裡把三種結果逐一釘住：
 * 自己的真正帳戶放行；別人的與不存在的一樣 404（不透露存在）；自己的臨時帳戶 400。
 * 用假的 client，只看函式怎麼解讀查詢結果。
 */
describe('account selection', () => {
  function client(row: { userId: string; isTemporary: boolean } | null, temporaryId?: string) {
    return {
      account: {
        findUnique: jest.fn().mockResolvedValue(row),
        findFirst: jest.fn().mockResolvedValue(temporaryId ? { id: temporaryId } : null),
      },
    };
  }

  describe('assertSelectableAccount', () => {
    it('accepts my own regular account', async () => {
      await expect(
        assertSelectableAccount(client({ userId: 'me', isTemporary: false }), 'me', 'cash'),
      ).resolves.toBeUndefined();
    });

    it('404s an account that does not exist', async () => {
      await expect(assertSelectableAccount(client(null), 'me', 'nope')).rejects.toMatchObject({
        status: 404,
        errorCode: 'NOT_FOUND',
      });
    });

    it("404s someone else's account, temporary or not", async () => {
      for (const isTemporary of [false, true]) {
        await expect(
          assertSelectableAccount(client({ userId: 'bob', isTemporary }), 'me', 'bobs'),
        ).rejects.toMatchObject({ status: 404, errorCode: 'NOT_FOUND' });
      }
    });

    it('400s my own temporary account', async () => {
      await expect(
        assertSelectableAccount(client({ userId: 'me', isTemporary: true }), 'me', 'temp'),
      ).rejects.toMatchObject({ status: 400, errorCode: 'TEMPORARY_ACCOUNT_NOT_SELECTABLE' });
    });
  });

  describe('temporaryAccountIdOf', () => {
    it('returns the id of the temporary account', async () => {
      const db = client(null, 'temp-1');
      await expect(temporaryAccountIdOf(db, 'me')).resolves.toBe('temp-1');
      expect(db.account.findFirst).toHaveBeenCalledWith({
        where: { userId: 'me', isTemporary: true },
        select: { id: true },
      });
    });

    it('throws when the user has none, instead of recording no account', async () => {
      await expect(temporaryAccountIdOf(client(null), 'me')).rejects.toThrow(
        'has no temporary account',
      );
    });
  });
});
