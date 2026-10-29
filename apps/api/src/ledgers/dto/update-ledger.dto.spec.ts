import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateLedgerDto } from './update-ledger.dto';

/** 以 class-transformer 與 class-validator 驗證帳本改名修剪及原有必填規則。 */
describe('UpdateLedgerDto name', () => {
  const createDto = (body: Record<string, unknown>) => plainToInstance(UpdateLedgerDto, body);
  const errors = (body: Record<string, unknown>) => validate(createDto(body));

  it.each([
    ['一般空白', ' 家庭帳本 ', '家庭帳本'],
    ['Tab', '\t家庭帳本\t', '家庭帳本'],
    ['換行', '\n家庭帳本\n', '家庭帳本'],
    ['全形空白', '\u3000家庭帳本\u3000', '家庭帳本'],
  ])('會去掉名稱前後的%s', async (_kind, input, expected) => {
    const dto = createDto({ name: input });
    expect(dto.name).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('保留名稱內部空白', async () => {
    const dto = createDto({ name: '家庭 帳本' });
    expect(dto.name).toBe('家庭 帳本');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('去掉空白後為空字串時拒絕名稱', async () => {
    expect(await errors({ name: ' \t\n\u3000 ' })).not.toHaveLength(0);
  });

  it('以修剪後的值套用長度上限', async () => {
    expect(await errors({ name: ` ${'A'.repeat(100)} ` })).toHaveLength(0);
    expect(await errors({ name: ` ${'A'.repeat(101)} ` })).not.toHaveLength(0);
  });

  it('不轉型並拒絕非字串名稱', async () => {
    for (const name of [42, { value: '家庭帳本' }]) {
      const dto = createDto({ name });
      expect(typeof dto.name).toBe(typeof name);
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('維持改名名稱必填，並拒絕 null', async () => {
    expect(await errors({})).not.toHaveLength(0);
    expect(await errors({ name: null })).not.toHaveLength(0);
  });
});
