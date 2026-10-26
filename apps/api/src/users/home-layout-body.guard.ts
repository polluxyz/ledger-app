import { BadRequestException, CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/** 在 ValidationPipe 移除禁鍵之前拒絕原始 body，以免惡意輸入被靜默修成合法版面。 */
@Injectable()
export class HomeLayoutBodyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ body: unknown }>();
    const stack = [{ value: request.body, depth: 0 }];
    while (stack.length > 0) {
      const { value, depth } = stack.pop()!;
      if (value === null || typeof value !== 'object') continue;
      if (depth > 32) throw new BadRequestException('版面格式不正確');
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
          throw new BadRequestException('版面格式不正確');
        }
        stack.push({ value: (value as Record<string, unknown>)[key], depth: depth + 1 });
      }
    }
    return true;
  }
}
