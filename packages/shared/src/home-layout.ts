import type { HomeCardId, HomeLayoutV1 } from './types/home-layout';

/** 版面只接受固定的 JSON 結構，避免前後端對同一份資料有不同解讀。 */
const CARD_IDS: Record<HomeCardId, true> = {
  expense: true,
  income: true,
  net: true,
  trend: true,
  categories: true,
  activity: true,
  accounts: true,
  debts: true,
};

type ParseResult = { ok: true; layout: HomeLayoutV1 } | { ok: false; reason: string };
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

function plain(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return (
    Object.keys(value).every((key) => own(value, key) && allowed.includes(key)) &&
    allowed.every((key) => own(value, key))
  );
}

/** 陣列也只允許自己的索引，不能把禁鍵藏在 JSON.stringify 忽略的額外欄位。 */
function array(value: unknown): value is unknown[] {
  return (
    Array.isArray(value) &&
    Object.keys(value).length === value.length &&
    Object.keys(value).every((key, index) => key === String(index) && own(value, key))
  );
}

/** 先限制序列化大小再走訪；任何非 JSON 輸入或存取例外都收斂成失敗，不讓讀取版面壞頁。 */
export function parseHomeLayoutV1(input: unknown): ParseResult {
  try {
    let serialized: string | undefined;
    try {
      serialized = JSON.stringify(input);
    } catch {
      return { ok: false, reason: 'NOT_SERIALIZABLE' };
    }
    if (serialized === undefined) return { ok: false, reason: 'NOT_SERIALIZABLE' };
    if (new TextEncoder().encode(serialized).length > 16384) {
      return { ok: false, reason: 'SIZE_LIMIT' };
    }
    if (!plain(input)) return { ok: false, reason: 'ROOT_OBJECT' };
    if (!keys(input, ['bands'])) return { ok: false, reason: 'ROOT_KEYS' };
    if (!array(input.bands)) return { ok: false, reason: 'BANDS_ARRAY' };
    if (input.bands.length < 1 || input.bands.length > 8) {
      return { ok: false, reason: 'BAND_COUNT' };
    }

    const stack: { node: unknown; depth: number; parentAxis?: string }[] = [];
    for (const band of input.bands) {
      if (!plain(band)) return { ok: false, reason: 'BAND_OBJECT' };
      if (!keys(band, ['root', 'extraHeightPx'])) return { ok: false, reason: 'BAND_KEYS' };
      if (
        typeof band.extraHeightPx !== 'number' ||
        !Number.isInteger(band.extraHeightPx) ||
        band.extraHeightPx < 0 ||
        band.extraHeightPx > 1600
      )
        return { ok: false, reason: 'EXTRA_HEIGHT' };
      stack.push({ node: band.root, depth: 0 });
    }

    const seen = new Set<string>();
    let nodeCount = 0;
    while (stack.length > 0) {
      const { node, depth, parentAxis } = stack.pop()!;
      if (++nodeCount > 32) return { ok: false, reason: 'NODE_COUNT' };
      if (!plain(node)) return { ok: false, reason: 'NODE_OBJECT' };
      if (!own(node, 'type')) return { ok: false, reason: 'NODE_TYPE' };
      if (node.type === 'card') {
        if (!keys(node, ['type', 'cardId'])) return { ok: false, reason: 'CARD_KEYS' };
        if (typeof node.cardId !== 'string' || !own(CARD_IDS, node.cardId)) {
          return { ok: false, reason: 'CARD_ID' };
        }
        if (seen.has(node.cardId)) return { ok: false, reason: 'DUPLICATE_CARD' };
        seen.add(node.cardId);
      } else if (node.type === 'split') {
        if (!keys(node, ['type', 'axis', 'children', 'weights'])) {
          return { ok: false, reason: 'SPLIT_KEYS' };
        }
        if (node.axis !== 'x' && node.axis !== 'y') return { ok: false, reason: 'SPLIT_AXIS' };
        if (node.axis === parentAxis) return { ok: false, reason: 'SAME_AXIS' };
        if (depth + 1 > 6) return { ok: false, reason: 'SPLIT_DEPTH' };
        if (!array(node.children)) return { ok: false, reason: 'CHILDREN_ARRAY' };
        if (node.children.length < 2) return { ok: false, reason: 'CHILD_COUNT' };
        if (!array(node.weights)) return { ok: false, reason: 'WEIGHTS_ARRAY' };
        if (node.weights.length !== node.children.length) {
          return { ok: false, reason: 'WEIGHT_COUNT' };
        }
        let sum = 0;
        for (const weight of node.weights) {
          if (typeof weight !== 'number' || !Number.isInteger(weight) || weight <= 0) {
            return { ok: false, reason: 'WEIGHT_VALUE' };
          }
          sum += weight;
        }
        if (sum !== 10000) return { ok: false, reason: 'WEIGHT_SUM' };
        for (const child of node.children) {
          stack.push({ node: child, depth: depth + 1, parentAxis: node.axis });
        }
      } else return { ok: false, reason: 'NODE_TYPE' };
    }
    if (seen.size !== Object.keys(CARD_IDS).length) return { ok: false, reason: 'MISSING_CARD' };
    return { ok: true, layout: input as unknown as HomeLayoutV1 };
  } catch {
    return { ok: false, reason: 'UNREADABLE_INPUT' };
  }
}
