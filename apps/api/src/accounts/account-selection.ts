import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@ledger/shared';
import { AppException } from '../common/exceptions/app.exception';

/**
 * 「使用者送進來的帳戶 id 能不能用」與「某人的臨時帳戶是哪一個」（3h 決策 167～169）。
 *
 * 所有收 `accountId`／`toAccountId` 的入口（交易、結清、分帳、借還、換帳戶）都只走
 * `assertSelectableAccount`，規則只寫在這裡一處：
 * - 帳戶不存在、或不是呼叫者的 → 404。兩種失敗回一樣的錯，不透露別人的帳戶存在。
 * - 是呼叫者自己的臨時帳戶 → 400 `TEMPORARY_ACCOUNT_NOT_SELECTABLE`。臨時帳戶只能由後端代填
 *   （付款人是別的成員時），使用者不能手動選。
 *
 * 用最小的 client 介面而不是 `PrismaService`，資料庫交易裡的 `tx` 與一般的 client 都能傳。
 */
interface AccountClient {
  account: {
    findUnique(args: {
      where: { id: string };
      select: { userId: true; isTemporary: true };
    }): Promise<{ userId: string; isTemporary: boolean } | null>;
    findFirst(args: {
      where: { userId: string; isTemporary: true };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
}

export async function assertSelectableAccount(
  client: AccountClient,
  userId: string,
  accountId: string,
): Promise<void> {
  const account = await client.account.findUnique({
    where: { id: accountId },
    select: { userId: true, isTemporary: true },
  });
  if (!account || account.userId !== userId) {
    throw new AppException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Account not found.');
  }
  if (account.isTemporary) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.TEMPORARY_ACCOUNT_NOT_SELECTABLE,
      'The temporary account cannot be chosen; pick one of your own accounts.',
    );
  }
}

/**
 * 某個使用者的臨時帳戶 id。每個使用者剛好一個（註冊時建立，migration 替既有使用者補建，
 * 資料庫有部分唯一索引）。找不到代表資料不一致，丟一般錯誤讓它變成 500，而不是悄悄記成沒有帳戶。
 */
export async function temporaryAccountIdOf(client: AccountClient, userId: string): Promise<string> {
  const account = await client.account.findFirst({
    where: { userId, isTemporary: true },
    select: { id: true },
  });
  if (!account) {
    throw new Error(`User ${userId} has no temporary account.`);
  }
  return account.id;
}
