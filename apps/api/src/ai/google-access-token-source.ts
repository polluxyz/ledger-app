import { GoogleAuth, type GoogleAuthOptions } from 'google-auth-library';
import type { AccessTokenSource } from './access-token-source';

/** 共用 GoogleAuth 讓套件管理 ADC、快取及併發更新；此類別不記錄任何認證資料。 */
export class GoogleAccessTokenSource implements AccessTokenSource {
  private readonly auth: GoogleAuth;
  private inFlight?: { startedAt: number; promise: Promise<string> };

  constructor(
    keyFilename?: string,
    createAuth: (options: GoogleAuthOptions) => GoogleAuth = (options) => new GoogleAuth(options),
  ) {
    this.auth = createAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      ...(keyFilename ? { keyFilename } : {}),
      clientOptions: {
        // 套件內建的認證請求會指定 retry=true；深層合併後 retry=0 仍能停用重試。
        transporterOptions: { retryConfig: { retry: 0, noResponseRetries: 0 }, timeout: 60_000 },
        // 套件的預設攔截器會在開啟 debug 時印出回應，連同 token 一起外洩。
        useAuthRequestParameters: false,
      },
    });
  }

  getAccessToken(): Promise<string> {
    // 代理登入的更新不一定由套件合併；只共用進行中的工作，不自行快取 token。
    // 超過 provider 的期限就容許新工作，避免某次 ADC 卡住讓後續請求永遠無法恢復。
    if (this.inFlight && Date.now() - this.inFlight.startedAt < 60_000) {
      return this.inFlight.promise;
    }
    const pending = this.readAccessToken().finally(() => {
      // 舊工作晚到時不能清掉已替換的新工作。
      if (this.inFlight?.promise === pending) this.inFlight = undefined;
    });
    this.inFlight = { startedAt: Date.now(), promise: pending };
    return pending;
  }

  private async readAccessToken(): Promise<string> {
    const token = await this.auth.getAccessToken();
    if (!token?.trim()) throw new Error('Access token unavailable');
    return token;
  }
}
