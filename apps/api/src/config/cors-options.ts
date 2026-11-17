import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/** 正式啟動與契約測試共用原有選項；未限制 allowedHeaders，讓預檢要求的標頭通過。 */
export function corsOptions(config: ConfigService<Env, true>): CorsOptions {
  return { origin: config.get('CORS_ORIGIN', { infer: true }) };
}
