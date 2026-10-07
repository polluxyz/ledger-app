import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGuestDto } from './create-guest.dto';

/** 確認虛擬成員的指向欄位可省略，提供時必須是 UUID。 */
describe('CreateGuestDto', () => {
  const counterpartyId = '123e4567-e89b-42d3-a456-426614174000';

  async function errorsFor(body: Record<string, unknown>) {
    return validate(plainToInstance(CreateGuestDto, body));
  }

  it('accepts a name with or without a UUID counterpartyId', async () => {
    await expect(errorsFor({ name: 'Guest' })).resolves.toHaveLength(0);
    await expect(errorsFor({ name: 'Guest', counterpartyId })).resolves.toHaveLength(0);
  });

  it('rejects a supplied counterpartyId that is not a UUID', async () => {
    const errors = await errorsFor({ name: 'Guest', counterpartyId: 'invalid' });

    expect(errors.some((error) => error.property === 'counterpartyId')).toBe(true);
  });
});
