import { ExecutionContext } from '@nestjs/common';
import { HomeLayoutBodyGuard } from './home-layout-body.guard';

/** 直接建自有禁鍵與陣列，驗證 pipe 前的守門不會漏掉任何深度。 */
describe('HomeLayoutBodyGuard', () => {
  const guard = new HomeLayoutBodyGuard();
  const context = (body: unknown) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ body }) }) }) as unknown as ExecutionContext;

  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const forbidden = () => JSON.parse(`{"${key}":{}}`) as unknown;
    it.each(['top', 'deep', 'array'])(`拒絕 ${key} 的 %s 自有鍵`, (location) => {
      const value = forbidden();
      const body =
        location === 'top'
          ? value
          : location === 'deep'
            ? { layout: { bands: value } }
            : { layout: [value] };
      expect(() => guard.canActivate(context(body))).toThrow('版面格式不正確');
    });
  }

  it('33 層物件拒絕；32 層可通過', () => {
    let body: unknown = {};
    for (let index = 0; index < 32; index++) body = { child: body };
    expect(guard.canActivate(context(body))).toBe(true);
    expect(() => guard.canActivate(context({ child: body }))).toThrow('版面格式不正確');
  });

  it('合法 body 與 null 放行，後續仍由 DTO 驗證', () => {
    expect(
      guard.canActivate(
        context({
          schemaVersion: 1,
          expectedRevision: 0,
          layout: { bands: [{ extraHeightPx: 0, root: { type: 'card', cardId: 'expense' } }] },
        }),
      ),
    ).toBe(true);
    expect(
      guard.canActivate(context({ schemaVersion: 1, expectedRevision: 0, layout: null })),
    ).toBe(true);
  });
});
