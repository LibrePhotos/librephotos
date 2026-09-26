import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@librephotos/api-client";
import { I18nextProvider } from "react-i18next";
import { useRef, type ReactNode } from "react";
import i18n from "@/i18n";
import { apiClient } from "@/lib/apiClient";

/**
 * App-wide providers, mounted once at the router root:
 *   - QueryClientProvider: TanStack Query cache (server state)
 *   - ApiClientProvider:   injects the configured api-client into every hook
 *   - I18nextProvider:     i18n scaffold
 * The theme is consumed per-screen via `useTheme()` rather than a provider.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        retry: 1,
      },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const queryClient = useRef<QueryClient>(makeQueryClient()).current;
  return (
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={apiClient}>
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
