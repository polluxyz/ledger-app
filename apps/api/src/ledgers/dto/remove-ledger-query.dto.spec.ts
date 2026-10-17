import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RemoveLedgerQueryDto } from './remove-ledger-query.dto';

describe('RemoveLedgerQueryDto', () => {
  it.each([
    ['true', true],
    ['false', false],
    [true, true],
    [false, false],
  ])('validates explicit %s as %s', async (value, expected) => {
    const dto = plainToInstance(RemoveLedgerQueryDto, { confirm: 'Trip', withdrawDebts: value });
    expect(await validate(dto)).toEqual([]);
    expect(dto.withdrawDebts).toBe(expected);
  });

  it.each(['yes', '1', '', ['true']])('rejects invalid consent %s', async (value) => {
    expect(
      await validate(plainToInstance(RemoveLedgerQueryDto, { withdrawDebts: value })),
    ).not.toHaveLength(0);
  });
});
