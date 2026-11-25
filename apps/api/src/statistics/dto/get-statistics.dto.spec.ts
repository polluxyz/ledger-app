import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LedgerAccessGuard } from '../../ledgers/guards/ledger-access.guard';
import { StatisticsController } from '../statistics.controller';
import { StatisticsService } from '../statistics.service';
import {
  GetLedgerStatisticsDto,
  GetStatisticsTrendDto,
  INVALID_STATISTICS_FILTER,
} from './get-statistics.dto';

/** 以原始查詢值驗證輸入轉換，以真實控制器產生文件來檢查公開契約。 */
describe('Statistics query DTOs', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  it('keeps the documented defaults and transforms the numeric query string', async () => {
    const statistics = plainToInstance(GetLedgerStatisticsDto, {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(await validate(statistics)).toEqual([]);
    expect(statistics.perspective).toBe('LEDGER');
    const trend = plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10', months: '24' });
    expect(await validate(trend)).toEqual([]);
    expect(trend.months).toBe(24);
    expect(plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10' }).months).toBe(12);
  });

  it.each([0, 25, 1.5, 'abc', null])('rejects invalid months %j', async (months) => {
    expect(
      await validate(plainToInstance(GetStatisticsTrendDto, { endMonth: '2026-10', months })),
    ).not.toHaveLength(0);
  });

  /** 用兩個端點的資料傳輸物件驗證共用篩選規則。 */
  describe.each([
    [
      'statistics',
      (query: object) =>
        plainToInstance(GetLedgerStatisticsDto, {
          from: '2026-10-01',
          to: '2026-10-31',
          ...query,
        }),
    ],
    [
      'trend',
      (query: object) =>
        plainToInstance(GetStatisticsTrendDto, {
          endMonth: '2026-10',
          ...query,
        }),
    ],
  ] as const)('%s filters', (_endpoint, create) => {
    it('transforms single values, repeated values, and spelled booleans', async () => {
      const other = '00000000-0000-4000-8000-000000000002';
      const dto = create({
        personIds: id,
        categoryIds: [id, other],
        accountIds: id,
        includeUncategorized: 'true',
        includeOtherAccounts: 'false',
      });
      expect(await validate(dto)).toEqual([]);
      expect(dto).toMatchObject({
        personIds: [id],
        categoryIds: [id, other],
        accountIds: [id],
        includeUncategorized: true,
        includeOtherAccounts: false,
      });
    });

    it.each([
      { personIds: Array<string>(51).fill(id) },
      { categoryIds: Array<string>(51).fill(id) },
      { accountIds: Array<string>(51).fill(id) },
      { personIds: 'not-a-uuid' },
      { categoryIds: [id, 'bad'] },
      { accountIds: { id } },
      { includeUncategorized: '1' },
      { includeOtherAccounts: 'TRUE' },
      { includeOtherAccounts: ['true', 'false'] },
      { includeOtherAccounts: true },
      { perspective: 'MINE', personIds: id },
    ])('rejects invalid filter %j', async (query) => {
      const errors = await validate(create(query));
      expect(errors).toHaveLength(1);
      expect(Object.values(errors[0]?.constraints ?? {})).toContain(INVALID_STATISTICS_FILTER);
    });
  });

  it('publishes filter schemas and filtered response fields in OpenAPI', async () => {
    const module = await Test.createTestingModule({
      controllers: [StatisticsController],
      providers: [{ provide: StatisticsService, useValue: {} }],
    })
      .overrideGuard(LedgerAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = module.createNestApplication();
    try {
      const { paths, components } = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().build(),
      );
      for (const path of [
        '/ledgers/{ledgerId}/statistics',
        '/ledgers/{ledgerId}/statistics/trend',
      ]) {
        const parameters = paths[path]?.get?.parameters;
        for (const name of ['personIds', 'categoryIds', 'accountIds']) {
          expect(parameters).toContainEqual(
            expect.objectContaining({
              name,
              in: 'query',
              required: false,
              schema: {
                type: 'array',
                maxItems: 50,
                items: { type: 'string', format: 'uuid' },
              },
            }),
          );
        }
        for (const name of ['includeUncategorized', 'includeOtherAccounts']) {
          expect(parameters).toContainEqual(
            expect.objectContaining({
              name,
              in: 'query',
              required: false,
              schema: { type: 'boolean' },
            }),
          );
        }
      }
      const statisticsSchema = components?.schemas?.LedgerStatisticsResponseDto;
      expect(statisticsSchema).toMatchObject({
        properties: { totals: { $ref: '#/components/schemas/StatisticsTotalsDto' } },
      });
      expect(
        statisticsSchema && 'required' in statisticsSchema && statisticsSchema.required,
      ).toContain('totals');
      const trendSchema = components?.schemas?.StatisticsTrendResponseDto;
      expect(trendSchema).toMatchObject({
        properties: {
          averageIncome: { type: 'integer', nullable: true },
          averageExpense: { type: 'integer', nullable: true },
          averageMonthCount: { type: 'integer' },
        },
      });
      for (const name of ['averageIncome', 'averageExpense', 'averageMonthCount']) {
        expect(trendSchema && 'required' in trendSchema && trendSchema.required).toContain(name);
      }
    } finally {
      await app.close();
    }
  });
});
