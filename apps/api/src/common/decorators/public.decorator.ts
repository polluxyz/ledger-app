import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 把路由標記為「免認證即可存取」。全域 JwtAuthGuard 會偵測這個標記並跳過 token
 * 驗證——其餘路由一律預設受保護（deny by default）。
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
