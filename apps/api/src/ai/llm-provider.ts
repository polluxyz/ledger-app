/**
 * 呼叫語言模型的介面（4a 決策 247）。
 *
 * `AiService` 只認得這個介面，不知道背後是 GLM、假 provider 還是測試的 stub。
 * 換模型只要多一個實作、在 factory 多一個分支，不動解析與檢查的程式。
 *
 * 這一層只負責「送出去、拿回 JSON」。拿回來的東西一律當成不可信的 `unknown`，
 * 由 `ai-draft-validation.ts` 逐欄檢查。
 */

/** 注入用的 token。測試用 `overrideProvider(LLM_PROVIDER)` 換成 stub。 */
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export interface LlmRequest {
  /** 指示與清單（帳本、分類、帳戶的代號）。清單標成資料，不是指令。 */
  system: string;
  /** 使用者的句子。只放這裡，不拼進 system。 */
  user: string;
  /** 要求模型回傳的 JSON 結構（`ai-wire-format.ts` 的 `AI_WIRE_JSON_SCHEMA`）。 */
  schema: Record<string, unknown>;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface LlmResponse {
  /** 模型回的 JSON，已經 parse 過。`null`＝回的不是 JSON（當成看不懂，決策 246）。 */
  content: unknown;
  /** 有回報就帶，給 T6 記錄 token 用量。 */
  usage?: LlmUsage;
}

export interface LLMProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmProviderErrorKind = 'http' | 'timeout' | 'network';

/**
 * provider 呼叫失敗（HTTP 錯誤、逾時、網路錯誤）。`AiService` 只把這一種錯誤轉成
 * 503 `AI_UNAVAILABLE`；其他例外照原本的路徑走。
 *
 * 為什麼只帶這三個欄位（決策 252）：錯誤物件會進日誌與例外 filter。句子、模型回應、
 * URL、原始 `cause` 都可能帶使用者的消費內容或金鑰，所以一律不放。
 * message 也只由這三個欄位組成。
 */
export class LlmProviderError extends Error {
  constructor(
    readonly kind: LlmProviderErrorKind,
    readonly status: number | null,
    readonly durationMs: number,
  ) {
    super(`LLM provider ${kind} error (status ${status ?? 'none'}, ${durationMs}ms)`);
    this.name = 'LlmProviderError';
  }
}
