import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddMemberRequest, LedgerMemberInfo, LedgerRole } from '@ledger/shared';
import { apiRequest } from '../../lib/api-client';
import { LEDGERS_KEY } from './use-ledgers';

/**
 * 帳本成員的伺服器狀態，端點巢狀在 `/ledgers/:ledgerId/members`。
 *
 * 前端不做任何權限判斷來決定「資料拿不拿得到」——那一律由後端的
 * `@RequireLedgerRole` 把關。呼叫端依角色隱藏按鈕只是體驗，不是授權。
 */
export function membersKey(ledgerId: string) {
  return ['members', ledgerId] as const;
}

/** 某帳本的成員清單。需要 VIEWER 以上；無權時後端回 404。 */
export function useMembers(ledgerId: string | null) {
  return useQuery({
    queryKey: membersKey(ledgerId ?? ''),
    queryFn: () => apiRequest<LedgerMemberInfo[]>(`/ledgers/${ledgerId as string}/members`),
    enabled: ledgerId !== null,
  });
}

/**
 * 以下三個 mutation 都不攔截錯誤——後端的 `errorCode` 才是呼叫端該分支判斷的
 * 依據（`USER_NOT_FOUND`、`ALREADY_MEMBER`、`LAST_OWNER_CANNOT_LEAVE`……）。
 */

/** 加入成員。只認**已註冊**的 email；查無此人時後端回 404 `USER_NOT_FOUND`。 */
export function useAddMember(ledgerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddMemberRequest) =>
      apiRequest<LedgerMemberInfo>(`/ledgers/${ledgerId}/members`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(ledgerId) });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledgerId] });
    },
  });
}

/** 變更成員角色。把最後一位 owner 降級時後端回 409 `LAST_OWNER_CANNOT_LEAVE`。 */
export function useUpdateMemberRole(ledgerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: LedgerRole }) =>
      apiRequest<LedgerMemberInfo>(`/ledgers/${ledgerId}/members/${userId}`, {
        method: 'PATCH',
        body: { role },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(ledgerId) });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledgerId] });
    },
  });
}

/**
 * 移除成員。同一個端點同時是「移除他人」（需 OWNER）與「自己退出」。
 *
 * 退出自己時整本帳本會從清單消失，所以連 `LEDGERS_KEY` 一起失效——少做這件事，
 * 畫面上會留著一本已經不屬於自己的帳本，點進去才發現 404。
 */
export function useRemoveMember(ledgerId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    // 成功時後端回 204 無 body，`apiRequest` 會回 undefined。
    mutationFn: (userId: string) =>
      apiRequest<void>(`/ledgers/${ledgerId}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: membersKey(ledgerId) });
      void queryClient.invalidateQueries({ queryKey: ['ledger', ledgerId] });
      void queryClient.invalidateQueries({ queryKey: LEDGERS_KEY });
    },
  });
}
