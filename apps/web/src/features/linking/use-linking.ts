import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  AcceptDebtProposalRequest,
  Counterparty,
  CreateFriendRequestRequest,
  DebtProposal,
  FriendInviteLinkCreated,
  FriendInviteLinkPreview,
  FriendRequest,
  LinkAccepted,
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
 * 3b-2 修訂 1 起所有邀請都是連動邀請、不綁任何對象（決策 73）。接受後要不要問「之前有沒有
 * 用別的名字記過他」（`askMerge`）、顯示用的名字（`displayName`）、提議換成誰的角度，全部由
 * 後端算好，這裡只打 API。
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
/** 送出的待確認邀請、待詢問的對象通常只有幾筆；一頁就夠。 */
const LIST_LIMIT = 100;

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

/** 收到、還沒回應的連動邀請。回傳陣列：卡片只需要清單本身。 */
export function useIncomingLinkInvites() {
  return useQuery({
    queryKey: [...FRIEND_REQUESTS_KEY, 'incoming', 'PENDING'],
    queryFn: () =>
      apiRequest<Paginated<FriendRequest>>(
        `/friend-requests?direction=incoming&status=PENDING&limit=${PENDING_LIMIT}`,
      ),
    select: (page) => page.items,
  });
}

/**
 * 待詢問的對象（決策 75）：連動成立時自動建立、還沒回答「之前有沒有用別的名字記過他」。
 * 放在對象的快取前綴底下，合併、改名、清標記之後跟著失效。
 */
export function useMergePrompts() {
  return useQuery({
    queryKey: [...COUNTERPARTIES_KEY, 'merge-prompts'],
    queryFn: () =>
      apiRequest<Paginated<Counterparty>>(`/counterparties?askMerge=true&limit=${LIST_LIMIT}`),
    select: (page) => page.items,
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
 * 接受連動邀請。**不帶 body**（決策 74）：後端替雙方各建一個已連動的對象。
 * 回應的 `askMerge` 為 true 時，畫面接著跳「之前有用別的名字記過他嗎？」（W50）。
 */
export function useAcceptLinkInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      apiRequest<LinkAccepted>(`/friend-requests/${requestId}/accept`, { method: 'POST' }),
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
// 送出的：對象頁的「邀請連動」與「邀請中」（W46、W50）
// ---------------------------------------------------------------------------

/** 用 email 邀請對方連動。不綁任何對象（決策 73）。 */
export function useSendLinkInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateFriendRequestRequest) =>
      apiRequest<FriendRequest>('/friend-requests', { method: 'POST', body: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: FRIEND_REQUESTS_KEY }),
  });
}

/**
 * 產生邀請連結。`token` 的原文只在這個回應出現一次：畫面組成 `${origin}/invite#${token}`
 * 給使用者複製，**不要存進任何 storage、不要記 log**。重新產生會讓之前的連結失效（後端負責）。
 */
export function useCreateInviteLink() {
  return useMutation({
    mutationFn: () =>
      apiRequest<FriendInviteLinkCreated>('/friend-invite-links', { method: 'POST' }),
  });
}

/** 我送出、還沒被回應的邀請（對象頁的「邀請中」）。 */
export function useOutgoingInvites() {
  return useQuery({
    queryKey: [...FRIEND_REQUESTS_KEY, 'outgoing', 'PENDING'],
    queryFn: () =>
      apiRequest<Paginated<FriendRequest>>(
        `/friend-requests?direction=outgoing&status=PENDING&limit=${LIST_LIMIT}`,
      ),
    select: (page) => page.items,
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

/** 用邀請連結接受。body 只有 `{ token }`（決策 74），回應同 `useAcceptLinkInvite`。 */
export function useAcceptInviteLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiRequest<LinkAccepted>('/friend-invite-links/accept', { method: 'POST', body: { token } }),
    onSuccess: () => invalidateAfterResponse(queryClient),
  });
}
