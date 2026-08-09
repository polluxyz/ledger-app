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
