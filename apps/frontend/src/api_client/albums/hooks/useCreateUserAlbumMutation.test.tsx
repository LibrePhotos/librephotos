/**
 * Creating a user album answers the new album, so My Albums can open it (#612). An album made with
 * photos says how many went in; an empty one opens straight away and says nothing.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CreateUserAlbumParams } from "../types";
import { useCreateUserAlbumMutation } from "./useCreateUserAlbumMutation";

const stubs = vi.hoisted(() => ({
  post: vi.fn<(endpoint: string, data?: unknown) => Promise<unknown>>(),
  createAlbum: vi.fn<(title: string, count: number) => void>(),
}));

vi.mock("../../api", async importOriginal => ({
  ...(await importOriginal<typeof import("../../api")>()),
  apiClient: { post: (...args: Parameters<typeof stubs.post>) => stubs.post(...args) },
}));
vi.mock("../../../service/notifications", () => ({ notification: { createAlbum: stubs.createAlbum } }));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.clearAllMocks();
  stubs.post.mockResolvedValue({ id: 12, title: "Iceland 2026" });
});

async function create(params: CreateUserAlbumParams) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let mutate: ReturnType<typeof useCreateUserAlbumMutation>["mutateAsync"] | undefined;
  function Harness() {
    mutate = useCreateUserAlbumMutation().mutateAsync;
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    );
  });
  if (!mutate) throw new Error("the hook did not render");
  const run = mutate;
  let album: unknown;
  await act(async () => {
    album = await run(params);
  });
  await act(async () => root.unmount());
  return album;
}

describe("useCreateUserAlbumMutation", () => {
  it("creates an empty album, answers it and shows no toast", async () => {
    const album = await create({ title: "Iceland 2026", photos: [] });

    expect(stubs.post).toHaveBeenCalledWith("/albums/user/edit/", { title: "Iceland 2026", photos: [] });
    expect(album).toEqual({ id: 12, title: "Iceland 2026" });
    expect(stubs.createAlbum).not.toHaveBeenCalled();
  });

  it("says how many photos went into an album made from a selection", async () => {
    await create({ title: "Iceland 2026", photos: ["p1", "p2"] });

    expect(stubs.createAlbum).toHaveBeenCalledWith("Iceland 2026", 2);
  });

  it("counts a selected-all set by the number the page showed", async () => {
    await create({ title: "Iceland 2026", photos: [], select_all: true, query: {}, photoCount: 40 });

    expect(stubs.post).toHaveBeenCalledWith(
      "/albums/user/edit/",
      expect.objectContaining({ title: "Iceland 2026", select_all: true })
    );
    expect(stubs.createAlbum).toHaveBeenCalledWith("Iceland 2026", 40);
  });
});
