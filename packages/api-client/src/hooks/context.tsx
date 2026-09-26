import { createContext, createElement, useContext, type ReactNode } from "react";
import type { ApiClient } from "../transport/types";

/**
 * React context carrying the configured ApiClient. This is the ONLY React
 * surface in the package (transport + endpoints are React-free). The app builds
 * the client at init (injecting its own fetch, base URL, and token supplier) and
 * wraps the tree in <ApiClientProvider>.
 */
const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider(props: { client: ApiClient; children: ReactNode }) {
  return createElement(ApiClientContext.Provider, { value: props.client }, props.children);
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) {
    throw new Error("useApiClient must be used within an <ApiClientProvider>");
  }
  return client;
}
