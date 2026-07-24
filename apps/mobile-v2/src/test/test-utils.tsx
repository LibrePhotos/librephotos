import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiClientProvider,
  createApiClient,
  type ApiClient,
  type TokenSupplier,
} from "@librephotos/api-client";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider } from "react-native-safe-area-context";
import i18n from "@/i18n";

/** A token supplier backed by a plain object for tests. */
export function fakeTokens(access: string | null = "test-access", refresh: string | null = "test-refresh"): TokenSupplier {
  const store = { access, refresh };
  return {
    getAccessToken: () => store.access,
    getRefreshToken: () => store.refresh,
    setAccessToken: (t) => {
      store.access = t;
    },
    clearTokens: () => {
      store.access = null;
      store.refresh = null;
    },
  };
}

/** Build an ApiClient over a mocked fetch handler. */
export function makeMockClient(handler: (url: string, init?: RequestInit) => Promise<Response>): ApiClient {
  return createApiClient({
    baseUrl: "https://test.local",
    tokens: fakeTokens(),
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init)) as typeof fetch,
  });
}

/** Wrap UI in the app providers, injecting a (usually mocked) ApiClient. */
export function renderWithProviders(ui: ReactElement, client: ApiClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider client={client}>
          <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
        </ApiClientProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
  return render(ui, { wrapper: Wrapper });
}

/** JSON Response helper. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
