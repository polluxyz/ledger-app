import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAccountDto } from './create-account.dto';

/** 以 class-transformer 與 class-validator 驗證帳戶名稱修剪及原有長度規則。 */
describe('CreateAccountDto name', () => {
  const createDto = (body: Record<string, unknown>) => plainToInstance(CreateAccountDto, body);
  const errors = (body: Record<string, unknown>) => validate(createDto(body));

  it.each([
    ['一般空白', ' 國泰世華 ', '國泰世華'],
    ['Tab', '\t國泰世華\t', '國泰世華'],
    ['換行', '\n國泰世華\n', '國泰世華'],
    ['全形空白', '\u3000國泰世華\u3000', '國泰世華'],
  ])('會去掉名稱前後的%s', async (_kind, input, expected) => {
    const dto = createDto({ name: input });
    expect(dto.name).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('保留名稱內部空白', async () => {
    const dto = createDto({ name: '國泰 世華' });
    expect(dto.name).toBe('國泰 世華');
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
    for (const name of [42, { value: '國泰世華' }]) {
      const dto = createDto({ name });
      expect(typeof dto.name).toBe(typeof name);
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('維持建立帳戶名稱必填', async () => {
    expect(await errors({})).not.toHaveLength(0);
  });
});
