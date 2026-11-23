/** The photo details the lightbox polls while an edit's rendition is made: the grids follow when it is ready. */
import { photoGridKeys, photoKeys, type Photo } from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { makePhoto } from "../../../components/lightbox/photoFixture.test-utils";

const stubs = vi.hoisted(() => ({ get: vi.fn<(endpoint: string) => Promise<unknown>>() }));
vi.mock("../../api", () => ({ apiClient: stubs }));

const { useFetchPhotoDetailsQuery } = await import("./useFetchPhotoDetailsQuery");

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const edited = (rendition: "pending" | "ready"): Photo =>
  makePhoto({ image_hash: "abc", edit: { version: 2, rendition, width: 300, height: 200 } });

/** Mounts the query over a cache that holds `cached`, the server answering `answer`; the grids it invalidated. */
async function refetch(cached: Photo, answer: Photo) {
  const client = new QueryClient();
  client.setQueryData(photoKeys.detail("abc"), cached);
  const invalidate = vi.spyOn(client, "invalidateQueries");
  stubs.get.mockResolvedValue(answer);
  function Probe() {
    useFetchPhotoDetailsQuery("abc");
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
  await act(async () => {
    await new Promise(resolve => {
      setTimeout(resolve, 0);
    });
  });
  await act(async () => root.unmount());
  expect(client.getQueryData(photoKeys.detail("abc"))).toMatchObject({ edit: answer.edit });
  return invalidate.mock.calls.map(([filters]) => filters?.queryKey);
}

describe("useFetchPhotoDetailsQuery", () => {
  it("refreshes every grid when the edit's rendition goes from pending to ready", async () => {
    expect(await refetch(edited("pending"), edited("ready"))).toEqual([photoGridKeys.all]);
  });

  it("leaves the grids alone while it is still pending, or was ready already", async () => {
    expect(await refetch(edited("pending"), edited("pending"))).toEqual([]);
    expect(await refetch(edited("ready"), edited("ready"))).toEqual([]);
  });
});
