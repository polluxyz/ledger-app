import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AcceptDebtProposalRequest,
  Counterparty,
  DebtProposal,
  FriendInviteLinkAccepted,
  FriendInviteLinkPreview,
  FriendRequest,
  LinkCounterpartyChoice,
  Paginated,
} from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { ACCOUNTS_KEY } from '../accounts/use-accounts';
import { COUNTERPARTIES_KEY } from '../debts/use-debts';

/**
 * 連動（3b-2）的伺服器狀態：連動邀請、提議、邀請連結。規格見 `docs/specs/phase-3b2-web.md`。
 *
 * 後端沿用 3a 的名稱（`/friend-requests`、`/friend-invite-links`），畫面上不出現「好友」
 * （W22）——名稱只留在這一層的網址裡。
 *
 * ## 前端不推導
 *
 * 哪些是連動邀請（`forLink`）、邀請屬於哪個對象（`counterpartyId`，F25）、提議換成誰的角度，
 * 全部由後端算好。這裡只做「從清單挑出符合條件的那筆」這種查找（W42）。
 *
 * ## 接受或拒絕之後要失效的東西
 *
 * 接受連動邀請會新增或改動對象；接受提議可能寫往來紀錄、交易與帳戶餘額。所以一律失效
 * 待確認、對象、交易與帳戶；少失效一個只會讓畫面停在舊數字，不會拋錯。
 */

/** 連動邀請（含送出與收到）的前綴。 */
export const FRIEND_REQUESTS_KEY = ['friend-requests'] as const;
/** 提議的前綴。 */
export const DEBT_PROPOSALS_KEY = ['debt-proposals'] as const;
/** 交易快取的前綴（見 `use-transactions.ts`），不分帳本。 */
const ALL_TRANSACTIONS_KEY = ['transactions'] as const;

/** 待確認卡片一次取幾筆（spec §4.5）。 */
const PENDING_LIMIT = 20;
/** 送出的待確認邀請通常只有幾筆；取一頁足夠找到某個對象的那筆。 */
const OUTGOING_LIMIT = 100;

function invalidateAfterResponse(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY });
  void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY });
  void queryClient.invalidateQueries({ queryKey: COUNTERPARTIES_KEY });
  void queryClient.invalidateQueries({ queryKey: ALL_TRANSACTIONS_KEY });
  void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
}

// ---------------------------------------------------------------------------
// 收到的：總覽的待確認卡片（W34～W39）
// ---------------------------------------------------------------------------

/**
 * 收到、還沒回應的**連動**邀請。3a 的一般邀請畫面上已經沒有入口，這裡濾掉（W35）。
 * 回傳的是篩過的陣列，不是分頁物件：卡片只需要清單本身。
 */
export function useIncomingLinkInvites() {
  return useQuery({
    queryKey: [...FRIEND_REQUESTS_KEY, 'incoming', 'PENDING'],
    queryFn: () =>
      apiRequest<Paginated<FriendRequest>>(
        `/friend-requests?direction=incoming&status=PENDING&limit=${PENDING_LIMIT}`,
      ),
    select: (page) => page.items.filter((request) => request.forLink),
  });
}

/** 收到、還沒回應的提議，新到舊（後端排序）。 */
export function useIncomingProposals() {
  return useQuery({
    queryKey: [...DEBT_PROPOSALS_KEY, 'incoming', 'PENDING'],
    queryFn: () =>
      apiRequest<Paginated<DebtProposal>>(
        `/debt-proposals?direction=incoming&status=PENDING&limit=${PENDING_LIMIT}`,
      ),
  });
}

/**
 * 接受連動邀請，選自己這邊的人（W39）：既有未連動的 `{ id }`，或新名字 `{ name }`。
 *
 * 回傳接上的**對象 id**，讓畫面接著打開那本往來帳。後端的回應是那筆邀請，而收到的邀請
 * 不帶對象 id（F25 只給發起者），所以新名字的情況要再查一次：用 `?q=` 找完全同名的那位
 * （同一位使用者底下名字不重複）。
 */
export function useAcceptLinkInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      requestId,
      counterparty,
    }: {
      requestId: string;
      counterparty: LinkCounterpartyChoice;
    }): Promise<{ counterpartyId: string | null }> => {
      await apiRequest<FriendRequest>(`/friend-requests/${requestId}/accept`, {
        method: 'POST',
        body: { counterparty },
      });
      if ('id' in counterparty) {
        return { counterpartyId: counterparty.id };
      }
      const name = counterparty.name.trim();
      const found = await apiRequest<Paginated<Counterparty>>(
        `/counterparties?q=${encodeURIComponent(name)}&limit=${OUTGOING_LIMIT}`,
      );
      return { counterpartyId: found.items.find((item) => item.name === name)?.id ?? null };
    },
    onSuccess: () => invalidateAfterResponse(queryClient),
  });
}

/** 拒絕連動邀請。不會改動自己的帳，所以畫面不另開確認（W36）。 */
export function useDeclineLinkInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<FriendRequest>(`/friend-requests/${requestId}/decline`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY }),
  });
}

/**
 * 接受提議。只有 `CREATE` 且種類是借出、借入、還款時帶 `record`（物件或 `null`）；
 * 其他提議不帶 body 欄位（後端會回 400）。
 *
 * 409 `NOTHING_TO_REPAY`／`REPAYMENT_EXCEEDS_BALANCE` 時提議維持待確認（W38），
 * `PROPOSAL_NOT_PENDING` 表示已經處理過——這三種都在 `onError` 重新取待確認。
 */
export function useAcceptProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      proposalId,
      input,
    }: {
      proposalId: string;
      input?: AcceptDebtProposalRequest;
    }) =>
      apiRequest<DebtProposal>(`/debt-proposals/${proposalId}/accept`, {
        method: 'POST',
        body: input ?? {},
      }),
    onSuccess: () => invalidateAfterResponse(queryClient),
    onError: () => void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY }),
  });
}

/** 拒絕提議。自己的帳不變；對方那筆會標「對方未接受」。 */
export function useDeclineProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) =>
      apiRequest<DebtProposal>(`/debt-proposals/${proposalId}/decline`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY }),
    onError: () => void queryClient.invalidateQueries({ queryKey: DEBT_PROPOSALS_KEY }),
  });
}

// ---------------------------------------------------------------------------
// 送出的：往來帳的「已邀請，等對方接受」（W29、F25）
// ---------------------------------------------------------------------------

/**
 * 這個對象送出、還沒回應的連動邀請；沒有時是 `null`。
 * 從我送出的待確認邀請裡挑 `counterpartyId` 相符的那筆（查找，不是推導）。
 */
export function useOutgoingLinkInvite(counterpartyId: string | null) {
  return useQuery({
    queryKey: [...FRIEND_REQUESTS_KEY, 'outgoing', 'PENDING'],
    queryFn: () =>
      apiRequest<Paginated<FriendRequest>>(
        `/friend-requests?direction=outgoing&status=PENDING&limit=${OUTGOING_LIMIT}`,
      ),
    enabled: counterpartyId !== null,
    select: (page) =>
      page.items.find((request) => request.forLink && request.counterpartyId === counterpartyId) ??
      null,
  });
}

/** 取消自己送出的邀請。 */
export function useCancelLinkInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<FriendRequest>(`/friend-requests/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY }),
  });
}

// ---------------------------------------------------------------------------
// 邀請頁 /invite#<token>（W41）
// ---------------------------------------------------------------------------

/**
 * 預覽邀請連結。token 放在 body，不進網址路徑或 query key：query key 會留在快取與
 * 開發者工具裡，這裡用固定的 key，並在離開頁面後立刻回收（`gcTime: 0`）。
 * `token` 為 `null`（網址沒有 token 或還沒登入）時不發請求。
 */
export function useInvitePreview(token: string | null) {
  return useQuery({
    queryKey: ['invite-preview'],
    queryFn: () =>
      apiRequest<FriendInviteLinkPreview>('/friend-invite-links/preview', {
        method: 'POST',
        body: { token: token! },
      }),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
  });
}

/**
 * 用邀請連結接受。連動邀請要帶 `counterparty`；3a 留下的一般邀請連結不可帶（§4.6）。
 * 回應帶接受者這邊接上的 `counterpartyId`，畫面用它打開往來帳。
 */
export function useAcceptInviteLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      token,
      counterparty,
    }: {
      token: string;
      counterparty?: LinkCounterpartyChoice;
    }) =>
      apiRequest<FriendInviteLinkAccepted>('/friend-invite-links/accept', {
        method: 'POST',
        body: counterparty === undefined ? { token } : { token, counterparty },
      }),
    onSuccess: () => invalidateAfterResponse(queryClient),
  });
}
