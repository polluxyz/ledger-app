import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ParseTransactionDto } from './parse-transaction.dto';

/** 對外輸入先 trim 再判斷字數，並用日曆日拒絕 Date 會自動進位的壞日期。 */
describe('ParseTransactionDto', () => {
  const base = {
    ledgerId: '00000000-0000-4000-8000-000000000000',
    today: '2024-02-29',
    text: ' 早餐 ',
  };
  it('trims and accepts 200 characters including emoji', async () => {
    const dto = plainToInstance(ParseTransactionDto, base);
    expect(dto.text).toBe('早餐');
    expect(await validate(dto)).toEqual([]);
    expect(
      await validate(
        plainToInstance(ParseTransactionDto, { ...base, text: ` ${'🍳'.repeat(200)} ` }),
      ),
    ).toEqual([]);
  });
  it.each([
    { text: ' ' },
    { text: 'a'.repeat(201) },
    { text: 12 },
    { ledgerId: 'bad' },
    { today: '2026-02-30' },
    { today: '1900-02-29' },
    { today: 1 },
  ])('rejects invalid input %p', async (overrides) => {
    expect(
      (await validate(plainToInstance(ParseTransactionDto, { ...base, ...overrides }))).length,
    ).toBeGreaterThan(0);
  });
});
