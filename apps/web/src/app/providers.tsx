import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ApiError } from '../lib/api-client';

/**
 * 集中掛載全應用的 Provider。順序有意義：AuthProvider 內部用到 useQueryClient，
 * 因此必須在 QueryClientProvider 之內。
 */
export function AppProviders({ children }: { children: ReactNode }) {
  // 用 useState 建立，確保整個應用生命週期共用同一個 client 實例
  // （直接寫 new QueryClient() 會在每次重新渲染時重建，快取就沒了）。
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 4xx 是「請求本身有問題」，重試無意義；只對其他錯誤重試一次。
            retry: (failureCount, error) => {
              if (error instanceof ApiError && error.statusCode < 500) {
                return false;
              }
              return failureCount < 1;
            },
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
