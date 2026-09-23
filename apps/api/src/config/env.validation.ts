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
