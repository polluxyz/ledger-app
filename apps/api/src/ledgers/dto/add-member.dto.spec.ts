import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddMemberDto } from './add-member.dto';

/** 驗證新增成員的兩種互斥輸入，避免空身分或同時帶入兩種身分。 */
describe('AddMemberDto', () => {
  const counterpartyId = '123e4567-e89b-42d3-a456-426614174000';

  async function errorsFor(body: Record<string, unknown>) {
    return validate(plainToInstance(AddMemberDto, body));
  }

  it('accepts either email or counterpartyId with a role', async () => {
    await expect(errorsFor({ email: 'bob@example.com', role: 'EDITOR' })).resolves.toHaveLength(0);
    await expect(errorsFor({ counterpartyId, role: 'VIEWER' })).resolves.toHaveLength(0);
  });

  it('rejects both identifiers or neither identifier', async () => {
    const both = await errorsFor({ email: 'bob@example.com', counterpartyId, role: 'EDITOR' });
    const neither = await errorsFor({ role: 'EDITOR' });

    expect(both.some((error) => error.constraints?.exactlyOneMemberIdentifier)).toBe(true);
    expect(neither.some((error) => error.constraints?.exactlyOneMemberIdentifier)).toBe(true);
  });

  it('validates a supplied counterpartyId as a UUID', async () => {
    const errors = await errorsFor({ counterpartyId: 'not-a-uuid', role: 'EDITOR' });

    expect(errors.some((error) => error.property === 'counterpartyId')).toBe(true);
  });
});
