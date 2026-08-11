import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest } from './api-client';

/**
 * api client 的單元測試：token 附帶與否、統一錯誤格式解析、401 會清掉本機
 * token、204 無內容。fetch 以 mock 取代，不打真實後端。
 */
describe('apiRequest', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 造一個假的 Response；jsdom 內建的 Response 足以應付。 */
  function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  it('attaches the bearer token when signed in', async () => {
    localStorage.setItem('ledger.accessToken', 'jwt-123');
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'u1' }));

    await apiRequest('/users/me');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
  });

  it('omits the token on anonymous requests even when one is stored', async () => {
    localStorage.setItem('ledger.accessToken', 'jwt-123');
    fetchMock.mockResolvedValue(jsonResponse(200, { accessToken: 'new' }));

    await apiRequest('/auth/login', {
      method: 'POST',
      body: { email: 'a@b.c', password: 'x' },
      anonymous: true,
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(init.body).toBe(JSON.stringify({ email: 'a@b.c', password: 'x' }));
  });

  it('turns the unified error body into an ApiError', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, {
        statusCode: 409,
        errorCode: 'EMAIL_ALREADY_EXISTS',
        message: 'Email is already registered.',
      }),
    );

    await expect(apiRequest('/auth/register')).rejects.toMatchObject({
      constructor: ApiError,
      statusCode: 409,
      errorCode: 'EMAIL_ALREADY_EXISTS',
    });
  });

  it('exposes field-level details from validation failures', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        statusCode: 400,
        errorCode: 'VALIDATION_FAILED',
        message: 'Validation failed',
        details: ['amount must be an integer'],
      }),
    );

    await expect(apiRequest('/transactions')).rejects.toMatchObject({
      details: ['amount must be an integer'],
    });
  });

  it('clears the stored token on 401 so the UI cannot stay "signed in"', async () => {
    localStorage.setItem('ledger.accessToken', 'expired');
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        statusCode: 401,
        errorCode: 'UNAUTHORIZED',
        message: 'Invalid or expired token',
      }),
    );

    await expect(apiRequest('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(localStorage.getItem('ledger.accessToken')).toBeNull();
  });

  it('falls back to a safe message when the body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(apiRequest('/ledgers')).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'UNKNOWN',
    });
  });

  it('returns undefined for 204 No Content', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await expect(apiRequest('/ledgers/l1/transactions/t1')).resolves.toBeUndefined();
  });
});
