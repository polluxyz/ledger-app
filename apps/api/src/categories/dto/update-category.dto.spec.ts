import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CATEGORY_NAME_MAX_LENGTH } from '@ledger/shared';
import { UpdateCategoryDto } from './update-category.dto';

/** 以 class-transformer 與 class-validator 驗證分類改名、空值與 null 的差異。 */
describe('UpdateCategoryDto name', () => {
  const createDto = (body: Record<string, unknown>) => plainToInstance(UpdateCategoryDto, body);
  const errors = (body: Record<string, unknown>) => validate(createDto(body));

  it.each([
    ['一般空白', ' 餐飲 ', '餐飲'],
    ['Tab', '\t餐飲\t', '餐飲'],
    ['換行', '\n餐飲\n', '餐飲'],
    ['全形空白', '\u3000餐飲\u3000', '餐飲'],
  ])('會去掉名稱前後的%s', async (_kind, input, expected) => {
    const dto = createDto({ name: input });
    expect(dto.name).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('保留名稱內部空白', async () => {
    const dto = createDto({ name: '日常 餐飲' });
    expect(dto.name).toBe('日常 餐飲');
    expect(await validate(dto)).toHaveLength(0);
  });

  it('去掉空白後為空字串時拒絕名稱', async () => {
    expect(await errors({ name: ' \t\n\u3000 ' })).not.toHaveLength(0);
  });

  it('以修剪後的值套用長度上限', async () => {
    expect(await errors({ name: ` ${'A'.repeat(CATEGORY_NAME_MAX_LENGTH)} ` })).toHaveLength(0);
    expect(
      await errors({ name: ` ${'A'.repeat(CATEGORY_NAME_MAX_LENGTH + 1)} ` }),
    ).not.toHaveLength(0);
  });

  it('不轉型並拒絕非字串名稱', async () => {
    for (const name of [42, { value: '餐飲' }]) {
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
