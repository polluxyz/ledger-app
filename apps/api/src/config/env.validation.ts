import { z } from 'zod';

/**
 * API 啟動所需環境變數的 schema。在啟動時驗證一次，讓缺漏／不合法的值「早死」
 * （fail fast），而不是拖到執行期才冒出令人困惑的錯誤。
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
  JWT_EXPIRES_IN: z.string().min(1).default('7d'),
  PORT: z.coerce.number().int().positive().default(3000),
  /**
   * API 監聽的網路位址。預設只聽本機，同一個網路裡的其他裝置連不到；
   * 不指定時 Node 會聽所有網路介面，等於把開發中的 API 開給整個區網。
   * 要讓實機 App 或容器連進來時，再明確設成 `0.0.0.0`。留空視同未設定。
   *
   * 預設寫 `localhost` 而不是 `127.0.0.1`：前端與 e2e 都連 `localhost`，Windows 會先
   * 解析成 IPv6 的 `::1`。只聽 `127.0.0.1` 時，瀏覽器每條連線都要等 `::1` 失敗才改連，
   * 畫面明顯變慢。聽 `localhost` 會落在同一個解析結果上，跟前端一致。
   */
  HOST: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).default('localhost'),
  ),
  LLM_PROVIDER: z.enum(['glm', 'fake', 'vertex']).default('fake'),
  VERTEX_PROJECT_ID: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/)
      .optional(),
  ),
  VERTEX_LOCATION: z.preprocess(
    blankAsUndefined,
    z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .default('global'),
  ),
  VERTEX_MODEL: z.preprocess(blankAsUndefined, z.string().optional()),
  // 明確保留給 ConfigService，避免 Zod 丟掉未列入 schema 的憑證設定。
  GOOGLE_APPLICATION_CREDENTIALS: z.preprocess(blankAsUndefined, z.string().optional()),
  GLM_API_KEY: z.string().optional(),
  GLM_MODEL: z.string().optional(),
  AI_PARSE_DAILY_LIMIT_PER_USER: quotaNumber(0, 10000, 50),
  AI_DAILY_LIMIT_GLOBAL: quotaNumber(0, 1000000, 500),
  AI_PARSE_MAX_OUTPUT_TOKENS: quotaNumber(256, 32768, 2048),
  GLM_BASE_URL: z.string().default('https://api.z.ai/api/paas/v4'),
  /**
   * GLM 的思考強度（`reasoning_effort`）。glm-5.3 一定會思考、預設 max，太慢；
   * 設 `low` 才能在逾時內回應（spec 決策 249）。留空就不送這個欄位，其他模型照舊。
   */
  GLM_REASONING_EFFORT: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.enum(['low', 'high', 'max']).optional(),
  ),
  /**
   * 允許跨來源存取本 API 的前端網址（CORS）。Web 前端與 API 跑在不同的 port／
   * 網域，屬不同來源，瀏覽器預設會擋下請求，必須由後端明示放行。
   * 預設值為 Vite 開發伺服器；正式部署時改成實際的前端網域。
   *
   * **多個來源用逗號分隔**（例如 `https://app.example.com,https://staging.example.com`）。
   * 一個來源時照舊寫一個字串即可。解析成陣列的動作在下面的 `transform` 做，
   * 讓 `main.ts` 拿到的一律是字串陣列——放行清單的形狀只有一種，不必在兩個
   * 地方各判斷一次。
   *
   * 每個來源仍然是**完全比對**，逗號只是把清單寫在一個環境變數裡，
   * 不會放寬任何一筆的比對規則。
   */
  CORS_ORIGIN: z
    .string()
    .min(1)
    .default('http://localhost:5173')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .refine((origins) => origins.length > 0, 'CORS_ORIGIN must list at least one origin'),
});

export type Env = z.infer<typeof envSchema>;

/** 空白等同未設定；非空的 project / location 不 trim，避免接受格式錯誤的網址片段。 */
function blankAsUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

/** 空白代表未設定，不能讓數值轉型把它當成停用的 0。 */
function quotaNumber(min: number, max: number, fallback: number) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(min).max(max).default(fallback),
  );
}

/**
 * 傳給 ConfigModule.forRoot({ validate })。驗證失敗時，拋出一段可讀的錯誤訊息，
 * 逐一列出每個有問題的變數。
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  return result.data;
}
