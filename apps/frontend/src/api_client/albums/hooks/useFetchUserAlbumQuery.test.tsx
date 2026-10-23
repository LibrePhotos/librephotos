/**
 * An album's days come newest first from the server; the hook puts them in the user's photo order
 * (#2712) without changing what it caches, so an oldest-first user reads a trip from its first day.
 */
import { userKeys, type PhotoOrder } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { tempPigPhoto } from "../../../util/util";

const stubs = vi.hoisted(() => ({
  fetchUserAlbum: vi.fn<(client: unknown, id: string, options: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("@librephotos/api-client", async importOriginal => {
  const actual = await importOriginal<typeof import("@librephotos/api-client")>();
  return { ...actual, endpoints: { ...actual.endpoints, fetchUserAlbum: stubs.fetchUserAlbum } };
});
vi.mock("../../api", () => ({ apiClient: {} }));
vi.mock("../../auth/hooks", () => ({
  useAccessToken: () => ({ data: { access: { user_id: 7 } }, isPending: false }),
}));

const { useFetchUserAlbumQuery } = await import("./useFetchUserAlbumQuery");

const photo = (id: string) => ({ ...tempPigPhoto(id), image_hash: id, isTemp: false });
const album = {
  id: 2,
  title: "Lisbon",
  grouped_photos: [
    { date: "2023-05-04T10:00:00Z", location: "", items: [photo("b2"), photo("b1")] },
    { date: "2023-05-03T10:00:00Z", location: "", items: [photo("a1")] },
  ],
};

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  stubs.fetchUserAlbum.mockReset();
});

async function render(order: PhotoOrder) {
  const client = new QueryClient();
  client.setQueryData(userKeys.selfDetail("7"), { id: 7, photo_order: order });
  stubs.fetchUserAlbum.mockResolvedValue(album);
  const result: { current?: ReturnType<typeof useFetchUserAlbumQuery> } = {};
  function Probe() {
    result.current = useFetchUserAlbumQuery("2", { mediaType: "videos" });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  for (let i = 0; i < 50 && !result.current?.data; i += 1) {
    await act(async () => new Promise(resolve => setTimeout(resolve, 10)));
  }
  await act(async () => root.unmount());
  return result.current?.data;
}

const days = (data: Awaited<ReturnType<typeof render>>) =>
  data?.grouped_photos.map(group => group.items.map(item => item.id));

describe("useFetchUserAlbumQuery", () => {
  it("shows the album's days oldest first for an oldest-first user", async () => {
    expect(days(await render("oldest"))).toEqual([["a1"], ["b1", "b2"]]);
    expect(stubs.fetchUserAlbum).toHaveBeenCalledWith({}, "2", expect.objectContaining({ video: true }));
  });

  it("keeps them as they came for newest first", async () => {
    expect(days(await render("newest"))).toEqual([["b2", "b1"], ["a1"]]);
  });
});
