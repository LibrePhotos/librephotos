import { QueryClient, QueryClientProvider, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * Render a hook inside a fresh QueryClient, run `start` on its first result,
 * and wait (in act) until `isDone` holds for its latest one. Requests go
 * wherever the hook sends them: stub `fetch` to test through the real client.
 */
async function renderUntil<R>(useHook: () => R, isDone: (result: R) => boolean, start?: (result: R) => void) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  let latest: { value: R } | undefined;
  function Host() {
    latest = { value: useHook() };
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Host />
      </QueryClientProvider>
    );
  });
  if (start && latest) {
    const first = latest.value;
    act(() => start(first));
  }
  for (let attempt = 0; attempt < 50 && !(latest && isDone(latest.value)); attempt++) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
  act(() => root.unmount());
  client.clear();
  if (!latest || !isDone(latest.value)) {
    throw new Error("the hook did not settle");
  }
  return latest.value;
}

/** A query hook's result once its first fetch has settled (data or error). */
export function settledQuery<T>(useHook: () => UseQueryResult<T>): Promise<UseQueryResult<T>> {
  return renderUntil(useHook, result => !result.isPending);
}

/** A mutation hook's result after one `mutate()` without variables has settled. */
export function settledMutation<T>(
  useHook: () => UseMutationResult<T, Error, void>
): Promise<UseMutationResult<T, Error, void>> {
  return renderUntil(
    useHook,
    result => result.isSuccess || result.isError,
    result => result.mutate()
  );
}
