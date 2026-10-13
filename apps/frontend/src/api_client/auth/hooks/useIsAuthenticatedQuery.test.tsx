/**
 * Whether the user is signed in is a synchronous cookie read, so the first render must already know
 * it (#2238). Without initial data the query was `isLoading` for its first render, and the protected
 * layout painted a bare spinner in the top-left corner of an empty page on every load.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { clearAuthCookies, setAuthCookie } from "../../authCookies";
import { useIsAuthenticatedQuery } from "./useIsAuthenticatedQuery";

type Snapshot = { data: boolean | undefined; isLoading: boolean };

let root: Root | undefined;
let renders: Snapshot[];

function Harness() {
  const { data, isLoading } = useIsAuthenticatedQuery();
  renders.push({ data, isLoading });
  return null;
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const container = document.createElement("div");
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <QueryClientProvider client={queryClient}>
        <Harness />
      </QueryClientProvider>
    );
  });
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  renders = [];
  clearAuthCookies();
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  clearAuthCookies();
});

describe("useIsAuthenticatedQuery", () => {
  it("knows on the first render that a user with an access cookie is signed in", async () => {
    setAuthCookie("access", "token");
    await mount();
    expect(renders[0]).toEqual({ data: true, isLoading: false });
  });

  it("knows on the first render that a user without one is not", async () => {
    await mount();
    expect(renders[0]).toEqual({ data: false, isLoading: false });
  });
});
