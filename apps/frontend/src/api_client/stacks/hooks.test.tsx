/**
 * Merging stacks and creating a manual stack invalidated ["photos"], a key no query uses, so the
 * photo grids kept showing the old stack badges and covers until a reload.
 */
import { QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { queryClient } from "../api";
import { photoGridKeys } from "../photos/keys";
import { Photoset } from "../photos/types";
import { useCreateManualStackMutation, useMergeStacksMutation } from "./hooks";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
}));

vi.mock("../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../api")>()),
  fetchClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
// The response shape is not under test here.
vi.mock("../../util/zodUtils", () => ({ parseWithNotification: (_schema: unknown, data: unknown) => data }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => queryClient.clear());

const timeline = photoGridKeys.dateAlbumList([Photoset.NONE, undefined, undefined, undefined, "all", ""]);
const userAlbum = photoGridKeys.userAlbumView("7", false, "", "all");

async function run<T>(useHook: () => { mutateAsync: (variables: T) => Promise<unknown> }, variables: T) {
  let mutation: { mutateAsync: (variables: T) => Promise<unknown> } | undefined;
  function Probe() {
    mutation = useHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await defined(mutation).mutateAsync(variables);
  });
  await act(async () => root.unmount());
}

function seedGrids() {
  queryClient.setQueryData(timeline, []);
  queryClient.setQueryData(userAlbum, {});
}

const isStale = (queryKey: readonly unknown[]) => queryClient.getQueryState(queryKey)?.isInvalidated;

describe("stack mutations", () => {
  it("merging stacks refreshes the photo grids", async () => {
    stubs.post.mockResolvedValue({});
    seedGrids();

    await run(useMergeStacksMutation, { photo_hashes: ["a", "b"] });

    expect(isStale(timeline)).toBe(true);
    expect(isStale(userAlbum)).toBe(true);
  });

  it("creating a manual stack refreshes the photo grids", async () => {
    stubs.post.mockResolvedValue({});
    seedGrids();

    await run(useCreateManualStackMutation, { photo_hashes: ["a", "b"] });

    expect(isStale(timeline)).toBe(true);
    expect(isStale(userAlbum)).toBe(true);
  });
});
