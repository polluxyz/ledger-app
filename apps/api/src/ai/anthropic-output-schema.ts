import type { LlmRequest } from './llm-provider';

const REMOVED_KEYWORDS = new Set(['maxItems', 'minItems', 'maxLength', 'minLength']);
const ALLOWED_KEYWORDS = new Set([
  'type',
  'enum',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'pattern',
  ...REMOVED_KEYWORDS,
]);

/**
 * 只轉換已知的 schema 節點，不動原始格式。代號只由清單長度產生，
 * 讓相同長度的清單共用編譯快取；enum 仍不能取代草稿的授權檢查。
 */
export function createAnthropicOutputSchema(
  schema: Record<string, unknown>,
  codes: LlmRequest['codes'] = { ledgers: [], categories: [], accounts: [] },
): Record<string, unknown> {
  const ledgerEnum = [...numberedCodes('L', codes.ledgers.length), null];
  const categoryEnum = [...numberedCodes('C', codes.categories.length), null];
  const accountEnum = [...numberedCodes('A', codes.accounts.length), '?', null];
  const enums: Record<string, (string | null)[]> = {
    'drafts.items.ledger': ledgerEnum,
    'drafts.items.category': categoryEnum,
    'drafts.items.account': accountEnum,
    'drafts.items.toAccount': accountEnum,
  };

  function transform(node: Record<string, unknown>, path: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [keyword, value] of Object.entries(node)) {
      // 不帶未知關鍵字名稱，避免未來誤將資料值帶進錯誤訊息。
      if (!ALLOWED_KEYWORDS.has(keyword)) throw new Error('Unsupported output schema keyword.');
      if (REMOVED_KEYWORDS.has(keyword)) continue;
      if (keyword === 'properties') {
        if (!isRecord(value)) throw new Error('Invalid output schema properties.');
        result[keyword] = Object.fromEntries(
          Object.entries(value).map(([name, child]) => {
            if (!isRecord(child)) throw new Error('Invalid output schema property.');
            return [name, transform(child, path ? `${path}.${name}` : name)];
          }),
        );
      } else if (keyword === 'items') {
        if (!isRecord(value)) throw new Error('Invalid output schema items.');
        result[keyword] = transform(value, `${path}.items`);
      } else {
        result[keyword] = structuredClone(value);
      }
    }
    if (Object.hasOwn(enums, path)) result['enum'] = [...enums[path]!];
    return result;
  }

  return transform(schema, '');
}

function numberedCodes(prefix: string, length: number): string[] {
  return Array.from({ length }, (_, index) => `${prefix}${index + 1}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
