import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAccountDto } from './update-account.dto';

/** 以 class-transformer 與 class-validator 驗證帳戶改名、空值與 null 的差異。 */
describe('UpdateAccountDto name', () => {
  const createDto = (body: Record<string, unknown>) => plainToInstance(UpdateAccountDto, body);
  const errors = (body: Record<string, unknown>) => validate(createDto(body));

  it.each([
    ['一般空白', ' 台灣銀行 ', '台灣銀行'],
    ['Tab', '\t台灣銀行\t', '台灣銀行'],
    ['換行', '\n台灣銀行\n', '台灣銀行'],
    ['全形空白', '\u3000台灣銀行\u3000', '台灣銀行'],
  ])('會去掉名稱前後的%s', async (_kind, input, expected) => {
    const dto = createDto({ name: input });
    expect(dto.name).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('保留名稱內部空白', async () => {
    const dto = createDto({ name: '台灣 銀行' });
    expect(dto.name).toBe('台灣 銀行');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('去掉空白後為空字串時拒絕名稱', async () => {
    expect(await errors({ name: ' \t\n\u3000 ' })).not.toHaveLength(0);
  });

  it('以修剪後的值套用長度上限', async () => {
    expect(await errors({ name: ` ${'A'.repeat(50)} ` })).toHaveLength(0);
    expect(await errors({ name: ` ${'A'.repeat(51)} ` })).not.toHaveLength(0);
  });

  it('不轉型並拒絕非字串名稱', async () => {
    for (const name of [42, { value: '台灣銀行' }]) {
      const dto = createDto({ name });
      expect(typeof dto.name).toBe(typeof name);
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('略過未送出的名稱，但拒絕 null', async () => {
    expect(await errors({})).toHaveLength(0);
    expect(await errors({ name: null })).not.toHaveLength(0);
  });
});
