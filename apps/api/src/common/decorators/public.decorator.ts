import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as accessible without authentication. The global JwtAuthGuard
 * checks for this and skips token verification — everything else is protected
 * by default (deny by default).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
