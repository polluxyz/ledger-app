import { createAnthropicOutputSchema } from './anthropic-output-schema';
import { AI_WIRE_JSON_SCHEMA } from './ai-wire-format';

/** 深度比較與節點巡覽驗證純函式、白名單及代號限制，不依賴模型服務。 */
describe('createAnthropicOutputSchema', () => {
  const codes = { ledgers: ['L1', 'L2'], categories: ['C1'], accounts: ['A1', 'A2'] };

  function draftProperties(schema: Record<string, unknown>): Record<string, unknown> {
    const properties = schema['properties'] as Record<string, Record<string, unknown>>;
    const items = properties['drafts']!['items'] as Record<string, unknown>;
    return items['properties'] as Record<string, unknown>;
  }

  it('SC-P42.1 strips unsupported size limits throughout schema nodes and preserves patterns', () => {
    const schema = {
      ...AI_WIRE_JSON_SCHEMA,
      minItems: 0,
      minLength: 0,
      properties: {
        ...(AI_WIRE_JSON_SCHEMA['properties'] as Record<string, unknown>),
        extra: { type: 'array', maxItems: 1, minItems: 0, items: { type: 'string', minLength: 1 } },
      },
    };
    const result = createAnthropicOutputSchema(schema, codes);
    expect(JSON.stringify(result)).not.toMatch(/maxItems|minItems|maxLength|minLength/);
    const properties = draftProperties(result);
    expect(properties['amountYuan']).toEqual({
      type: ['string', 'null'],
      pattern: '^\\d+(\\.\\d{1,2})?$',
    });
    expect(properties['date']).toEqual({
      type: ['string', 'null'],
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
    });
    expect(properties['type']).toEqual({ type: 'string', enum: ['EXPENSE', 'INCOME', 'TRANSFER'] });
    expect(result['additionalProperties']).toBe(false);
    expect(result['required']).toEqual(['drafts']);
  });

  it('SC-P42.2 leaves the source unchanged and shares no mutable arrays', () => {
    const before = structuredClone(AI_WIRE_JSON_SCHEMA);
    const result = createAnthropicOutputSchema(AI_WIRE_JSON_SCHEMA, codes);
    (result['required'] as string[]).push('changed');
    (draftProperties(result)['title'] as Record<string, unknown>)['type'] = 'changed';
    expect(AI_WIRE_JSON_SCHEMA).toEqual(before);
  });

  it('SC-P42.3 replaces redundant types with numbered enums and preserves null and unknown account markers', () => {
    const properties = draftProperties(createAnthropicOutputSchema(AI_WIRE_JSON_SCHEMA, codes));
    expect(properties['ledger']).toEqual({ enum: ['L1', 'L2', null] });
    expect(properties['category']).toEqual({ enum: ['C1', null] });
    for (const name of ['account', 'toAccount']) {
      expect(properties[name]).toEqual({ enum: ['A1', 'A2', '?', null] });
    }
  });

  it('SC-P42.3 handles empty or omitted codes without widening enums', () => {
    for (const empty of [undefined, { ledgers: [], categories: [], accounts: [] }]) {
      const properties = draftProperties(createAnthropicOutputSchema(AI_WIRE_JSON_SCHEMA, empty));
      expect(properties['ledger']).toEqual({ enum: [null] });
      expect(properties['category']).toEqual({ enum: [null] });
      for (const name of ['account', 'toAccount']) {
        expect(properties[name]).toEqual({ enum: ['?', null] });
      }
    }
  });

  it('SC-P42.4 depends only on list lengths, never names', () => {
    expect(createAnthropicOutputSchema(AI_WIRE_JSON_SCHEMA, codes)).toEqual(
      createAnthropicOutputSchema(AI_WIRE_JSON_SCHEMA, {
        ledgers: ['日常', '旅行'],
        categories: ['餐飲'],
        accounts: ['現金', '銀行'],
      }),
    );
  });

  it.each([
    { unknown: true },
    { properties: { value: { unknown: true } } },
    { items: { unknown: true } },
  ])('SC-P42.5 rejects unknown schema keywords at any node (%p)', (schema) => {
    expect(() => createAnthropicOutputSchema(schema)).toThrow('Unsupported output schema keyword.');
  });

  it('SC-P42.5 treats property names as names rather than schema keywords', () => {
    expect(createAnthropicOutputSchema({ properties: { maxLength: { type: 'string' } } })).toEqual({
      properties: { maxLength: { type: 'string' } },
    });
  });
});
