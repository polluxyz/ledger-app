import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RegisterDto } from './register.dto';

/** 以 class-transformer 與 class-validator 驗證註冊名稱修剪及原有長度規則。 */
describe('RegisterDto name', () => {
  const validFields = { email: 'alice@example.com', password: 'sup3rsecret' };
  const createDto = (body: Record<string, unknown>) =>
    plainToInstance(RegisterDto, { ...validFields, ...body });
  const errors = (body: Record<string, unknown>) => validate(createDto(body));

  it.each([
    ['一般空白', ' Alice ', 'Alice'],
    ['Tab', '\tAlice\t', 'Alice'],
    ['換行', '\nAlice\n', 'Alice'],
    ['全形空白', '\u3000Alice\u3000', 'Alice'],
  ])('會去掉名稱前後的%s', async (_kind, input, expected) => {
    const dto = createDto({ name: input });
    expect(dto.name).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('保留名稱內部空白', async () => {
    const dto = createDto({ name: 'First  Name' });
    expect(dto.name).toBe('First  Name');
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
    for (const name of [42, { value: 'Alice' }]) {
      const dto = createDto({ name });
      expect(typeof dto.name).toBe(typeof name);
      expect(await validate(dto)).not.toHaveLength(0);
    }
  });

  it('維持註冊名稱必填', async () => {
    expect(await errors({})).not.toHaveLength(0);
  });
});
