import { expect, type Page, type Route } from '@playwright/test';
import {
  DEFAULT_HOME_LAYOUT_V1,
  parseHomeLayoutV1,
  type HomeCardId,
  type HomeLayoutNode,
  type HomeLayoutV1,
  type PutHomeLayoutRequest,
} from '@ledger/shared';

export interface HomeLayoutNetworkLog {
  gets: number;
  puts: PutHomeLayoutRequest[];
}

export interface HomeLayoutRouteHandlers {
  get?: (route: Route, log: HomeLayoutNetworkLog) => Promise<void>;
  put?: (route: Route, body: PutHomeLayoutRequest, log: HomeLayoutNetworkLog) => Promise<void>;
}

/** 攔住首頁版面端點，讓每個瀏覽器 PUT 都先通過共用格式驗證。 */
export async function watchHomeLayoutRequests(
  page: Page,
  handlers: HomeLayoutRouteHandlers = {},
): Promise<HomeLayoutNetworkLog> {
  const log: HomeLayoutNetworkLog = { gets: 0, puts: [] };
  await page.route('**/users/me/home-layout/web', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      log.gets += 1;
      await (handlers.get ? handlers.get(route, log) : route.continue());
      return;
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as PutHomeLayoutRequest;
      if (body.layout !== null) {
        expect(parseHomeLayoutV1(body.layout).ok).toBe(true);
      }
      log.puts.push(body);
      await (handlers.put ? handlers.put(route, body, log) : route.continue());
      return;
    }
    await route.continue();
  });
  return log;
}

export function card(cardId: HomeCardId): HomeLayoutNode {
  return { type: 'card', cardId };
}

export function split(
  axis: 'x' | 'y',
  children: HomeLayoutNode[],
  weights: number[],
): HomeLayoutNode {
  return { type: 'split', axis, children, weights };
}

/** 將分類卡放在整列寬的下半部並加高，讓四個落點方向都通過尺寸限制。 */
export function wideCategoriesDefaultLayout(): HomeLayoutV1 {
  return {
    bands: DEFAULT_HOME_LAYOUT_V1.bands.map((band, index) => {
      if (index !== 1) return band;
      return {
        root: split('y', [card('trend'), card('categories')], [5000, 5000]),
        extraHeightPx: 400,
      };
    }),
  };
}

/** 早期可存格式可把八張卡排成一列，供回溯相容測試使用。 */
export function eightCardsInOneRow(): HomeLayoutV1 {
  const cardIds: HomeCardId[] = [
    'expense',
    'income',
    'net',
    'trend',
    'categories',
    'activity',
    'accounts',
    'debts',
  ];
  return {
    bands: [
      {
        root: split(
          'x',
          cardIds.map(card),
          Array.from({ length: 8 }, () => 1250),
        ),
        extraHeightPx: 0,
      },
    ],
  };
}

/** 合法的六層巢狀樹；把 expense 移到 accounts 旁會多出第七層分割。 */
export function layoutAtMaximumDepth(): HomeLayoutV1 {
  return {
    bands: [
      {
        root: split(
          'x',
          [
            card('expense'),
            card('debts'),
            split(
              'y',
              [
                card('income'),
                split(
                  'x',
                  [
                    card('net'),
                    split(
                      'y',
                      [
                        card('trend'),
                        split(
                          'x',
                          [
                            card('categories'),
                            split('y', [card('activity'), card('accounts')], [5000, 5000]),
                          ],
                          [5000, 5000],
                        ),
                      ],
                      [5000, 5000],
                    ),
                  ],
                  [5000, 5000],
                ),
              ],
              [5000, 5000],
            ),
          ],
          [2000, 2000, 6000],
        ),
        extraHeightPx: 0,
      },
    ],
  };
}

/** SC-Y29 指定的巢狀版面。 */
export function nestedWrappingLayout(): HomeLayoutV1 {
  return {
    bands: [
      {
        root: split(
          'x',
          [
            card('expense'),
            split(
              'y',
              [
                split(
                  'x',
                  [card('income'), card('net'), card('trend'), card('categories')],
                  [2500, 2500, 2500, 2500],
                ),
                split('x', [card('activity'), card('accounts'), card('debts')], [3333, 3333, 3334]),
              ],
              [5000, 5000],
            ),
          ],
          [5000, 5000],
        ),
        extraHeightPx: 0,
      },
    ],
  };
}

/** dnd-kit 的 PointerSensor 要求真實滑鼠事件，且移動距離超過啟動門檻。 */
export async function movePointerToCardSide(
  page: Page,
  sourceCardId: HomeCardId,
  targetCardId: HomeCardId,
  side: 'left' | 'right' | 'top' | 'bottom',
): Promise<void> {
  const source = page.locator(`[data-home-card-id="${sourceCardId}"]`);
  const target = page.locator(`[data-home-card-id="${targetCardId}"]`);
  const handle = source.getByRole('button', { name: /^拖動 / });
  await handle.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await handle.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('拖動測試找不到來源把手或目標卡。');

  const startX = sourceBox.x + sourceBox.width / 2;
  const startY = sourceBox.y + sourceBox.height / 2;
  const targetPoint = {
    left: { x: targetBox.x + targetBox.width * 0.15, y: targetBox.y + targetBox.height / 2 },
    right: { x: targetBox.x + targetBox.width * 0.85, y: targetBox.y + targetBox.height / 2 },
    top: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * 0.15 },
    bottom: { x: targetBox.x + targetBox.width / 2, y: targetBox.y + targetBox.height * 0.85 },
  }[side];

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 6, { steps: 2 });
  await page.mouse.move(targetPoint.x, targetPoint.y, { steps: 14 });
}

export async function expectCardOrder(page: Page, ids: readonly HomeCardId[]): Promise<void> {
  await expect
    .poll(
      async () =>
        page
          .locator(
            '[data-home-layout="tree"] [data-home-card-id], [data-home-layout="editing"] [data-home-card-id], [data-home-layout="narrow"] [data-home-card-id]',
          )
          .evaluateAll((cards) =>
            cards.map((element) => element.getAttribute('data-home-card-id')),
          ),
      { timeout: 10_000 },
    )
    .toEqual(ids);
}

export function nodeShape(node: HomeLayoutNode): string {
  return node.type === 'card'
    ? node.cardId
    : `${node.axis}[${node.children.map(nodeShape).join(',')}]`;
}
