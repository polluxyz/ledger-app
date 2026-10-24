import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import { createElement, type PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAccounts } from '../features/accounts/use-accounts';
import {
  useCreateAccount,
  useDeleteAccount,
  useUpdateAccount,
} from '../features/accounts/use-accounts';
import {
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../features/categories/use-categories';
import {
  useCreateCounterparty,
  useCreateDebtEntry,
  useDeleteCounterparty,
  useDeleteDebtEntry,
  useDismissMergePrompt,
  useForgiveCounterparty,
  useMergeCounterparty,
  useRenameCounterparty,
  useUnlinkCounterparty,
  useUpdateDebtEntry,
  useCounterparties,
  useCounterparty,
  useCounterpartyEntries,
  useCounterpartyEntryPages,
} from '../features/debts/use-debts';
import {
  useAcceptInviteLink,
  useAcceptLinkInvite,
  useAcceptProposal,
  useCancelLinkInvite,
  useCreateInviteLink,
  useDeclineLinkInvite,
  useDeclineProposal,
  useMergePrompts,
  useSendLinkInvite,
} from '../features/linking/use-linking';
import {
  useClearLedgerPointer,
  useLedgerGroups,
  useSetLedgerPointer,
} from '../features/ledger-people/use-ledger-pointers';
import {
  useCreateLedgerPerson,
  useDeleteLedgerPerson,
  useRenameLedgerPerson,
} from '../features/ledger-people/use-ledger-people';
import {
  useAddMember,
  useAddMemberTo,
  useRemoveMember,
  useUpdateMemberRole,
} from '../features/ledgers/use-members';
import {
  useArchiveLedger,
  useCreateLedger,
  useDeleteLedger,
  useLeaveLedger,
  useRenameLedger,
  useUnarchiveLedger,
} from '../features/ledgers/use-ledgers';
import { useBalanceTrend } from '../features/statistics/use-balance-trend';
import { useLedgerStatistics } from '../features/statistics/use-ledger-statistics';
import { useStatisticsTrend } from '../features/statistics/use-statistics-trend';
import {
  useCreateSettlement,
  useDeleteSettlement,
  useLedgerSettlementPages,
  useSetSettlementAccount,
  useSetTransactionAccount,
  useSettlementSummary,
  useUpdateSettlement,
} from '../features/settlements/use-settlements';
import { useSetTransactionMark, useMarkedTransactions } from '../features/transactions/use-marks';
import {
  useCreateSplit,
  useDeleteSplit,
  useSplit,
  useUpdateSplit,
} from '../features/transactions/use-splits';
import {
  useCreateTransactionForLedger,
  useDeleteTransaction,
  useTransactions,
  useUpdateTransaction,
} from '../features/transactions/use-transactions';
import { invalidateAfterMoneyWrite } from './invalidate-after-money-write';

const LEDGER_ID = 'ledger-1';
const OTHER_LEDGER_ID = 'ledger-2';
const LEDGER_STATISTICS_KEY = [
  'ledger-statistics',
  LEDGER_ID,
  '2026-10-01',
  '2026-10-31',
  'LEDGER',
] as const;
const RESPONSE_BODY = { id: LEDGER_ID, items: [], page: 1, limit: 20, total: 0 };

const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(RESPONSE_BODY),
  } as Response);
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function createWrapper(queryClient: QueryClient) {
  return function QueryClientWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  };
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

type MutationHook = () => {
  mutateAsync: (variables: never) => Promise<unknown>;
};

interface MutationCase {
  name: string;
  hook: MutationHook;
  variables: unknown;
  shouldInvalidate: boolean;
}

function mutationCase(
  name: string,
  hook: () => unknown,
  variables: unknown,
  shouldInvalidate: boolean,
): MutationCase {
  return {
    name,
    hook: hook as unknown as MutationHook,
    variables,
    shouldInvalidate,
  };
}

const mutationCases: MutationCase[] = [
  mutationCase(
    'useCreateTransactionForLedger',
    () => useCreateTransactionForLedger(),
    {
      ledgerId: LEDGER_ID,
      input: {},
    },
    true,
  ),
  mutationCase(
    'useUpdateTransaction',
    () => useUpdateTransaction(LEDGER_ID),
    {
      transactionId: 'transaction-1',
      input: {},
    },
    true,
  ),
  mutationCase(
    'useDeleteTransaction',
    () => useDeleteTransaction(LEDGER_ID),
    'transaction-1',
    true,
  ),
  mutationCase('useCreateDebtEntry', () => useCreateDebtEntry(), {}, true),
  mutationCase(
    'useUpdateDebtEntry',
    () => useUpdateDebtEntry(),
    {
      entryId: 'debt-entry-1',
      input: {},
    },
    true,
  ),
  mutationCase('useDeleteDebtEntry', () => useDeleteDebtEntry(), 'debt-entry-1', true),
  mutationCase(
    'useRenameCounterparty',
    () => useRenameCounterparty(),
    {
      counterpartyId: 'counterparty-1',
      name: 'Updated name',
    },
    true,
  ),
  mutationCase('useDeleteCounterparty', () => useDeleteCounterparty(), 'counterparty-1', true),
  mutationCase(
    'useForgiveCounterparty',
    () => useForgiveCounterparty(),
    {
      counterpartyId: 'counterparty-1',
      input: {},
    },
    true,
  ),
  mutationCase('useCreateCounterparty', () => useCreateCounterparty(), {}, true),
  mutationCase('useUnlinkCounterparty', () => useUnlinkCounterparty(), 'counterparty-1', true),
  mutationCase(
    'useMergeCounterparty',
    () => useMergeCounterparty(),
    {
      counterpartyId: 'counterparty-1',
      sourceId: 'counterparty-2',
    },
    true,
  ),
  mutationCase('useDismissMergePrompt', () => useDismissMergePrompt(), 'counterparty-1', true),
  mutationCase('useCreateSplit', () => useCreateSplit(), {}, true),
  mutationCase(
    'useUpdateSplit',
    () => useUpdateSplit(),
    {
      splitId: 'split-1',
      input: {},
    },
    true,
  ),
  mutationCase('useDeleteSplit', () => useDeleteSplit(), 'split-1', true),
  mutationCase('useCreateSettlement', () => useCreateSettlement(LEDGER_ID), {}, true),
  mutationCase(
    'useUpdateSettlement',
    () => useUpdateSettlement(LEDGER_ID),
    {
      settlementId: 'settlement-1',
      input: {},
    },
    true,
  ),
  mutationCase('useDeleteSettlement', () => useDeleteSettlement(LEDGER_ID), 'settlement-1', true),
  mutationCase(
    'useSetTransactionAccount',
    () => useSetTransactionAccount(LEDGER_ID),
    {
      transactionId: 'transaction-1',
      input: {},
    },
    true,
  ),
  mutationCase(
    'useSetSettlementAccount',
    () => useSetSettlementAccount(LEDGER_ID),
    {
      settlementId: 'settlement-1',
      input: {},
    },
    true,
  ),
  mutationCase('useAcceptLinkInvite', () => useAcceptLinkInvite(), 'request-1', true),
  mutationCase('useDeclineLinkInvite', () => useDeclineLinkInvite(), 'request-1', false),
  mutationCase(
    'useAcceptProposal',
    () => useAcceptProposal(),
    {
      proposalId: 'proposal-1',
      input: {},
    },
    true,
  ),
  mutationCase('useDeclineProposal', () => useDeclineProposal(), 'proposal-1', false),
  mutationCase('useSendLinkInvite', () => useSendLinkInvite(), {}, false),
  mutationCase('useCreateInviteLink', () => useCreateInviteLink(), undefined, false),
  mutationCase('useCancelLinkInvite', () => useCancelLinkInvite(), 'request-1', false),
  mutationCase('useAcceptInviteLink', () => useAcceptInviteLink(), 'invite-token', true),
  mutationCase('useCreateLedgerPerson', () => useCreateLedgerPerson(LEDGER_ID), {}, true),
  mutationCase(
    'useRenameLedgerPerson',
    () => useRenameLedgerPerson(LEDGER_ID),
    {
      personId: 'person-1',
      input: {},
    },
    true,
  ),
  mutationCase('useDeleteLedgerPerson', () => useDeleteLedgerPerson(LEDGER_ID), 'person-1', true),
  mutationCase(
    'useSetLedgerPointer',
    () => useSetLedgerPointer(),
    {
      ledgerId: LEDGER_ID,
      personId: 'person-1',
      counterpartyId: null,
    },
    true,
  ),
  mutationCase(
    'useClearLedgerPointer',
    () => useClearLedgerPointer(),
    {
      ledgerId: LEDGER_ID,
      personId: 'person-1',
    },
    true,
  ),
  mutationCase('useAddMember', () => useAddMember(LEDGER_ID), {}, true),
  mutationCase(
    'useAddMemberTo',
    () => useAddMemberTo(),
    {
      ledgerId: LEDGER_ID,
      email: 'member@example.test',
      role: 'EDITOR',
    },
    true,
  ),
  mutationCase(
    'useUpdateMemberRole',
    () => useUpdateMemberRole(LEDGER_ID),
    {
      userId: 'user-1',
      role: 'VIEWER',
    },
    false,
  ),
  mutationCase('useRemoveMember', () => useRemoveMember(LEDGER_ID), 'user-1', true),
  mutationCase('useLeaveLedger', () => useLeaveLedger(), { id: LEDGER_ID }, true),
  mutationCase(
    'useRenameLedger',
    () => useRenameLedger(),
    { id: LEDGER_ID, name: 'Renamed' },
    true,
  ),
  mutationCase('useArchiveLedger', () => useArchiveLedger(), LEDGER_ID, true),
  mutationCase('useUnarchiveLedger', () => useUnarchiveLedger(), LEDGER_ID, true),
  mutationCase(
    'useDeleteLedger',
    () => useDeleteLedger(),
    {
      id: LEDGER_ID,
      confirm: LEDGER_ID,
    },
    true,
  ),
  mutationCase('useCreateLedger', () => useCreateLedger(), {}, false),
  mutationCase(
    'useSetTransactionMark',
    () => useSetTransactionMark(),
    {
      ledgerId: LEDGER_ID,
      transactionId: 'transaction-1',
      currentlyMarked: false,
    },
    true,
  ),
  mutationCase('useCreateAccount', () => useCreateAccount(), {}, true),
  mutationCase(
    'useUpdateAccount',
    () => useUpdateAccount(),
    {
      id: 'account-1',
      name: 'Updated account',
    },
    true,
  ),
  mutationCase('useDeleteAccount', () => useDeleteAccount(), 'account-1', true),
  mutationCase(
    'useUpdateCategory',
    () => useUpdateCategory(LEDGER_ID),
    {
      id: 'category-1',
      name: 'Updated category',
    },
    true,
  ),
  mutationCase('useDeleteCategory', () => useDeleteCategory(LEDGER_ID), 'category-1', true),
  mutationCase('useCreateCategory', () => useCreateCategory(LEDGER_ID), {}, false),
];

describe('invalidateAfterMoneyWrite', () => {
  const moneyWritePrefixes: ReadonlyArray<{ name: string; key: QueryKey }> = [
    { name: 'transactions', key: ['transactions'] },
    { name: 'transaction', key: ['transaction'] },
    { name: 'marked-transactions', key: ['marked-transactions'] },
    { name: 'accounts', key: ['accounts'] },
    { name: 'balance-trend', key: ['balance-trend'] },
    { name: 'ledger-statistics', key: ['ledger-statistics'] },
    { name: 'statistics-trend', key: ['statistics-trend'] },
    { name: 'counterparties', key: ['counterparties'] },
    { name: 'ledger-groups', key: ['ledger-groups'] },
    { name: 'settlement-summary', key: ['settlement-summary'] },
    { name: 'ledger-settlements', key: ['ledger-settlements'] },
    { name: 'splits', key: ['splits'] },
  ];

  it('invalidates the twelve prefixes used by feature query hooks', async () => {
    const queryClient = createQueryClient();
    const transactionQuery = { from: '2026-10-01', to: '2026-10-31', page: 1 };
    const otherTransactionQuery = { from: '2026-09-01', to: '2026-09-30', page: 2 };
    const ledgerStatisticsQuery = {
      from: '2026-10-01',
      to: '2026-10-31',
      perspective: 'LEDGER',
    } as const;
    const mineStatisticsQuery = {
      from: '2026-09-01',
      to: '2026-09-30',
      perspective: 'MINE',
    } as const;
    const ledgerTrendQuery = {
      endMonth: '2026-10',
      months: 6,
      perspective: 'LEDGER',
    } as const;
    const mineTrendQuery = {
      endMonth: '2026-09',
      months: 12,
      perspective: 'MINE',
    } as const;
    const balanceTrendQuery = { endMonth: '2026-10', months: 6 } as const;
    const singleTransactionKey = ['transaction', LEDGER_ID, 'transaction-1'] as const;

    const { unmount } = renderHook(
      () => {
        useTransactions(LEDGER_ID, transactionQuery);
        useTransactions(OTHER_LEDGER_ID, otherTransactionQuery);
        useMarkedTransactions(false);
        useMarkedTransactions(true);
        useAccounts();
        useBalanceTrend(balanceTrendQuery);
        useLedgerStatistics(LEDGER_ID, ledgerStatisticsQuery);
        useLedgerStatistics(OTHER_LEDGER_ID, mineStatisticsQuery);
        useStatisticsTrend(LEDGER_ID, ledgerTrendQuery);
        useStatisticsTrend(OTHER_LEDGER_ID, mineTrendQuery);
        useCounterparties({ limit: 5 });
        useCounterparties({ limit: 10 });
        useCounterparty('counterparty-1');
        useCounterpartyEntries('counterparty-1', { page: 1, limit: 10 });
        useCounterpartyEntryPages('counterparty-1', 'outstanding');
        useMergePrompts();
        useLedgerGroups({ unpointed: true });
        useLedgerGroups({ unpointed: false });
        useSettlementSummary(LEDGER_ID);
        useLedgerSettlementPages(LEDGER_ID);
        useSplit('split-1');
      },
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    unmount();

    // 目前沒有讀取單筆 `transaction` key 的 hook；標註 mutation 使用這個既有失效目標。
    queryClient.setQueryData(singleTransactionKey, { id: 'transaction-1' });

    const keys = queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    const expectedHookKeys = [
      ['transactions', LEDGER_ID, transactionQuery],
      ['transactions', OTHER_LEDGER_ID, otherTransactionQuery],
      ['marked-transactions', false],
      ['marked-transactions', true],
      ['accounts'],
      ['balance-trend', balanceTrendQuery.endMonth, balanceTrendQuery.months],
      [
        'ledger-statistics',
        LEDGER_ID,
        ledgerStatisticsQuery.from,
        ledgerStatisticsQuery.to,
        'LEDGER',
      ],
      [
        'ledger-statistics',
        OTHER_LEDGER_ID,
        mineStatisticsQuery.from,
        mineStatisticsQuery.to,
        'MINE',
      ],
      ['statistics-trend', LEDGER_ID, ledgerTrendQuery.endMonth, ledgerTrendQuery.months, 'LEDGER'],
      ['statistics-trend', OTHER_LEDGER_ID, mineTrendQuery.endMonth, mineTrendQuery.months, 'MINE'],
      ['counterparties', 'detail', 'counterparty-1'],
      ['counterparties', 'entries', 'counterparty-1', { page: 1, limit: 10 }],
      ['counterparties', 'entry-pages', 'counterparty-1', 'outstanding'],
      ['counterparties', 'merge-prompts'],
      ['ledger-groups', { unpointed: true }],
      ['ledger-groups', { unpointed: false }],
      ['settlement-summary', LEDGER_ID],
      ['ledger-settlements', LEDGER_ID],
      ['splits', 'split-1'],
      singleTransactionKey,
    ];

    for (const key of expectedHookKeys) {
      expect(keys).toContainEqual(key);
    }
    expect(moneyWritePrefixes.map(({ name }) => name)).toEqual([
      'transactions',
      'transaction',
      'marked-transactions',
      'accounts',
      'balance-trend',
      'ledger-statistics',
      'statistics-trend',
      'counterparties',
      'ledger-groups',
      'settlement-summary',
      'ledger-settlements',
      'splits',
    ]);

    invalidateAfterMoneyWrite(queryClient);

    for (const prefix of moneyWritePrefixes) {
      const matchingQueries = queryClient.getQueryCache().findAll({ queryKey: prefix.key });
      expect(matchingQueries.length, prefix.name).toBeGreaterThan(0);
      expect(
        matchingQueries.every(({ state }) => state.isInvalidated),
        prefix.name,
      ).toBe(true);
    }

    queryClient.clear();
  });

  it('refetches active queries immediately', async () => {
    const queryClient = createQueryClient();
    const { unmount } = renderHook(
      () => useLedgerStatistics(LEDGER_ID, { from: '2026-10-01', to: '2026-10-31' }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    invalidateAfterMoneyWrite(queryClient);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    unmount();
    queryClient.clear();
  });

  it('marks inactive queries stale without refetching them', async () => {
    const queryClient = createQueryClient();
    const { unmount } = renderHook(
      () => useLedgerStatistics(LEDGER_ID, { from: '2026-10-01', to: '2026-10-31' }),
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    unmount();
    invalidateAfterMoneyWrite(queryClient);

    expect(queryClient.getQueryState(LEDGER_STATISTICS_KEY)?.isInvalidated).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    queryClient.clear();
  });

  it('leaves categories and friend-request queries unchanged', () => {
    const queryClient = createQueryClient();
    const categoryKey = ['categories', LEDGER_ID] as const;
    const friendRequestKey = ['friend-requests', 'incoming', 'PENDING'] as const;
    queryClient.setQueryData(categoryKey, []);
    queryClient.setQueryData(friendRequestKey, []);

    invalidateAfterMoneyWrite(queryClient);

    expect(queryClient.getQueryState(categoryKey)?.isInvalidated).toBe(false);
    expect(queryClient.getQueryState(friendRequestKey)?.isInvalidated).toBe(false);

    queryClient.clear();
  });
});

describe('money-write mutation invalidation decisions', () => {
  it.each(mutationCases)('$name follows its matrix decision', async (testCase) => {
    const queryClient = createQueryClient();
    queryClient.setQueryData(LEDGER_STATISTICS_KEY, { total: 123 });

    const { result, unmount } = renderHook(testCase.hook, {
      wrapper: createWrapper(queryClient),
    });
    await act(async () => {
      await result.current.mutateAsync(testCase.variables as never);
    });

    expect(queryClient.getQueryState(LEDGER_STATISTICS_KEY)?.isInvalidated).toBe(
      testCase.shouldInvalidate,
    );

    unmount();
    queryClient.clear();
  });

  it('keeps feature-specific keys alongside shared invalidation', async () => {
    const queryClient = createQueryClient();
    const debtProposalsKey = ['debt-proposals', 'incoming', 'PENDING'] as const;
    const friendRequestsKey = ['friend-requests', 'incoming', 'PENDING'] as const;
    const ledgerListKey = ['ledgers'] as const;
    const ledgerDetailKey = ['ledger', LEDGER_ID] as const;
    const memberListKey = ['members', OTHER_LEDGER_ID] as const;
    const otherLedgerDetailKey = ['ledger', OTHER_LEDGER_ID] as const;
    const categoriesKey = ['categories', OTHER_LEDGER_ID] as const;
    const ledgerPeopleKey = ['ledger-people', OTHER_LEDGER_ID] as const;

    for (const key of [
      debtProposalsKey,
      friendRequestsKey,
      ledgerListKey,
      ledgerDetailKey,
      memberListKey,
      otherLedgerDetailKey,
      categoriesKey,
      ledgerPeopleKey,
    ]) {
      queryClient.setQueryData(key, { cached: true });
    }

    const runMutation = async (hook: MutationHook, variables: unknown) => {
      const { result, unmount } = renderHook(hook, { wrapper: createWrapper(queryClient) });
      await act(async () => {
        await result.current.mutateAsync(variables as never);
      });
      unmount();
    };

    await runMutation(
      mutationCase('useCreateSplit', () => useCreateSplit(), undefined, true).hook,
      {},
    );
    expect(queryClient.getQueryState(debtProposalsKey)?.isInvalidated).toBe(true);

    await runMutation(
      mutationCase('useAcceptLinkInvite', () => useAcceptLinkInvite(), undefined, true).hook,
      'request-1',
    );
    expect(queryClient.getQueryState(friendRequestsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(debtProposalsKey)?.isInvalidated).toBe(true);

    await runMutation(
      mutationCase('useRenameLedger', () => useRenameLedger(), undefined, true).hook,
      { id: LEDGER_ID, name: 'Renamed' },
    );
    expect(queryClient.getQueryState(ledgerListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(ledgerDetailKey)?.isInvalidated).toBe(true);

    await runMutation(
      mutationCase('useAddMember', () => useAddMember(OTHER_LEDGER_ID), undefined, true).hook,
      {},
    );
    expect(queryClient.getQueryState(memberListKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherLedgerDetailKey)?.isInvalidated).toBe(true);

    await runMutation(
      mutationCase('useUpdateCategory', () => useUpdateCategory(OTHER_LEDGER_ID), undefined, true)
        .hook,
      { id: 'category-1', name: 'Updated' },
    );
    expect(queryClient.getQueryState(categoriesKey)?.isInvalidated).toBe(true);

    await runMutation(
      mutationCase(
        'useCreateLedgerPerson',
        () => useCreateLedgerPerson(OTHER_LEDGER_ID),
        undefined,
        true,
      ).hook,
      {},
    );
    expect(queryClient.getQueryState(ledgerPeopleKey)?.isInvalidated).toBe(true);

    queryClient.clear();
  });

  it('refetches ledger statistics and balance trend after a successful write', async () => {
    const queryClient = createQueryClient();
    const statisticsPath = `/ledgers/${LEDGER_ID}/statistics?`;
    const balanceTrendPath = '/accounts/balance-trend?';
    const matchingRequests = (path: string) =>
      mockFetch.mock.calls.filter(([input]) => requestUrl(input).includes(path)).length;

    const { result, unmount } = renderHook(
      () => {
        useLedgerStatistics(LEDGER_ID, { from: '2026-10-01', to: '2026-10-31' });
        useBalanceTrend({ endMonth: '2026-10', months: 6 });
        return useCreateTransactionForLedger();
      },
      { wrapper: createWrapper(queryClient) },
    );

    await waitFor(() => {
      expect(matchingRequests(statisticsPath)).toBe(1);
      expect(matchingRequests(balanceTrendPath)).toBe(1);
    });

    await act(async () => {
      await result.current.mutateAsync({ ledgerId: LEDGER_ID, input: {} as never });
    });

    await waitFor(() => {
      expect(matchingRequests(statisticsPath)).toBe(2);
      expect(matchingRequests(balanceTrendPath)).toBe(2);
    });

    unmount();
    queryClient.clear();
  });
});
