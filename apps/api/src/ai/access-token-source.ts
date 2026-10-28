/**
 * 拿 access token 的介面（Vertex 決策 340）。
 *
 * Vertex 的推論請求要帶 Google 的 OAuth access token。正式實作包 `google-auth-library`，
 * 測試用 `overrideProvider(VERTEX_TOKEN_SOURCE)` 換成假的，所以 e2e 不連 Google。
 *
 * 呼叫端注意（決策 342 (b)）：實作丟出的例外可能帶金鑰路徑、服務帳戶 email 等憑證細節。
 * 呼叫端只能轉成 `LlmProviderError('auth')`，原始例外直接丟掉，不放進 `cause`、不寫日誌。
 */
export interface AccessTokenSource {
  /** 回傳有效的 access token。拿不到就丟錯。 */
  getAccessToken(): Promise<string>;
}

/** 注入用的 token。 */
export const VERTEX_TOKEN_SOURCE = Symbol('VERTEX_TOKEN_SOURCE');

/**
 * 佔位實作：一律丟錯。T0 先註冊它，讓 e2e 能覆寫、typecheck 能過；T1 換成只在
 * `LLM_PROVIDER=vertex` 時建立的 `GoogleAccessTokenSource`。非 vertex 的環境仍用這個，
 * 避免 glm、fake 去找 GCP 憑證。
 */
export const unavailableTokenSource: AccessTokenSource = {
  getAccessToken: () => Promise.reject(new Error('Vertex access token source is not configured.')),
};
