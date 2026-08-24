import type { APIRequestContext, APIResponse } from '@playwright/test';
import type {
  Account,
  AddMemberRequest,
  AuthTokenResponse,
  AuthUser,
  Category,
  CreateLedgerRequest,
  CreateTransactionRequest,
  LedgerMemberInfo,
  LedgerRole,
  LedgerSummary,
  Transaction,
} from '@ledger/shared';
import { API_BASE_URL } from './env';

/**
 * 打真實 API 的輔助函式。
 *
 * 測試資料一律從這裡建立，不直接寫資料庫（D3）。直接塞資料庫會繞過驗證與業務
 * 規則，做出來的狀態可能是產品根本走不到的；而且那種 seed 程式碼會跟著 schema
 * 一起腐爛。
 *
 * 用 Playwright 內建的 `request`，不另外裝 HTTP 套件。
 *
 * 什麼時候該用這裡的函式、什麼時候該用畫面操作：**被測的那件事走畫面，前置條件
 * 走 API**。例如「刪除帳本會被 409 擋下」這條，前置的「別人記過一筆交易」用 API
 * 建立就好——那段流程在別條測試已經驗過了。
 */

/** 測試帳號一律用這個密碼。真實密碼絕不寫進測試（spec §9 Never）。 */
export const TEST_PASSWORD = 'sup3rsecret';

/** 一個已註冊並登入的測試帳號。 */
export interface TestUser {
  id: string;
  email: string;
  name: string;
  /** JWT；要嘛放進 `Authorization` 標頭，要嘛塞進瀏覽器的 localStorage。 */
  token: string;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/**
 * 檢查回應是否成功，失敗時把後端說的話一起丟出來。
 *
 * 少了這一層，測試失敗只會看到「undefined 沒有 id 屬性」這種二手症狀，
 * 得再花時間才找得到真正的原因（400 說欄位錯了、403 說沒權限）。
 */
async function readJson<T>(response: APIResponse, what: string): Promise<T> {
  if (!response.ok()) {
    throw new Error(`${what} 失敗：${response.status()} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

/** 註冊一個新帳號並登入，回傳可直接使用的 token。 */
export async function registerUser(
  request: APIRequestContext,
  email: string,
  name: string,
): Promise<TestUser> {
  const registered = await readJson<AuthUser>(
    await request.post(`${API_BASE_URL}/auth/register`, {
      data: { email, password: TEST_PASSWORD, name },
    }),
    `註冊 ${email}`,
  );

  const loggedIn = await readJson<AuthTokenResponse>(
    await request.post(`${API_BASE_URL}/auth/login`, {
      data: { email, password: TEST_PASSWORD },
    }),
    `登入 ${email}`,
  );

  return { id: registered.id, email, name, token: loggedIn.accessToken };
}

/** 列出使用者有權存取的帳本。註冊時會自動建立一本個人帳本，所以永遠至少有一本。 */
export async function listLedgers(
  request: APIRequestContext,
  token: string,
  options: { includeArchived?: boolean } = {},
): Promise<LedgerSummary[]> {
  const response = await request.get(`${API_BASE_URL}/ledgers`, {
    headers: authHeaders(token),
    params: options.includeArchived ? { includeArchived: 'true' } : {},
  });
  return readJson<LedgerSummary[]>(response, '列出帳本');
}

/** 取得註冊時自動建立的那本個人帳本。 */
export async function personalLedger(
  request: APIRequestContext,
  token: string,
): Promise<LedgerSummary> {
  const ledgers = await listLedgers(request, token);
  const personal = ledgers.find((ledger) => ledger.kind === 'PERSONAL');
  if (!personal) {
    throw new Error('找不到個人帳本——註冊時本應自動建立一本。');
  }
  return personal;
}

/** 建立帳本。`kind` 省略時是 PERSONAL，`tracksBalance` 省略時是 true。 */
export async function createLedger(
  request: APIRequestContext,
  token: string,
  body: CreateLedgerRequest,
): Promise<LedgerSummary> {
  const response = await request.post(`${API_BASE_URL}/ledgers`, {
    headers: authHeaders(token),
    data: body,
  });
  return readJson<LedgerSummary>(response, `建立帳本「${body.name}」`);
}

/**
 * 以 email 把一位**已註冊**的使用者加為成員。
 *
 * 只有共享帳本可以加成員；對個人帳本呼叫會得到 409
 * （`PERSONAL_LEDGER_CANNOT_SHARE`）。
 */
export async function addMember(
  request: APIRequestContext,
  token: string,
  ledgerId: string,
  body: AddMemberRequest,
): Promise<LedgerMemberInfo> {
  const response = await request.post(`${API_BASE_URL}/ledgers/${ledgerId}/members`, {
    headers: authHeaders(token),
    data: body,
  });
  return readJson<LedgerMemberInfo>(response, `把 ${body.email} 加入帳本`);
}

/** 變更成員角色。 */
export async function updateMemberRole(
  request: APIRequestContext,
  token: string,
  ledgerId: string,
  userId: string,
  role: LedgerRole,
): Promise<LedgerMemberInfo> {
  const response = await request.patch(`${API_BASE_URL}/ledgers/${ledgerId}/members/${userId}`, {
    headers: authHeaders(token),
    data: { role },
  });
  return readJson<LedgerMemberInfo>(response, '變更成員角色');
}

/** 列出帳本的分類。建立帳本時後端會自動放進一組預設分類。 */
export async function listCategories(
  request: APIRequestContext,
  token: string,
  ledgerId: string,
): Promise<Category[]> {
  const response = await request.get(`${API_BASE_URL}/ledgers/${ledgerId}/categories`, {
    headers: authHeaders(token),
  });
  return readJson<Category[]>(response, '列出分類');
}

/** 列出使用者的帳戶。註冊時會自動建立一個「現金」帳戶。 */
export async function listAccounts(request: APIRequestContext, token: string): Promise<Account[]> {
  const response = await request.get(`${API_BASE_URL}/accounts`, {
    headers: authHeaders(token),
  });
  return readJson<Account[]>(response, '列出帳戶');
}

/** 記一筆交易。欄位的條件必填規則見 `CreateTransactionRequest` 的說明。 */
export async function createTransaction(
  request: APIRequestContext,
  token: string,
  ledgerId: string,
  body: CreateTransactionRequest,
): Promise<Transaction> {
  const response = await request.post(`${API_BASE_URL}/ledgers/${ledgerId}/transactions`, {
    headers: authHeaders(token),
    data: body,
  });
  return readJson<Transaction>(response, '記一筆交易');
}
