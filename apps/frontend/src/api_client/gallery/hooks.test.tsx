/**
 * The public gallery's timeline (#434) as the photo lists lay it out: a placeholder per photo, each
 * day page filling its share of the day when it arrives, and a refetched timeline keeping the pages
 * it already had instead of going back to blank placeholders.
 */
import type * as ApiClientModule from "@librephotos/api-client";
import {
  photoGridKeys,
  type GalleryFilter,
  type IncompleteDatePhotosGroup,
  type PigPhoto,
} from "@librephotos/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { defined } from "../../util/defined.test-utils";
import { tempPigPhoto } from "../../util/util";
import { useGalleryDayQuery, useGalleryDaysQuery } from "./hooks";

const stubs = vi.hoisted(() => ({ dayCounts: [3, 1], asked: [] as string[] }));

function photo(id: string): PigPhoto {
  return { ...tempPigPhoto(id), image_hash: `hash-${id}`, isTemp: false };
}

vi.mock("@librephotos/api-client", async importOriginal => {
  const original = await importOriginal<typeof ApiClientModule>();
  return {
    ...original,
    endpoints: {
      ...original.endpoints,
      fetchGalleryDays: async (): Promise<IncompleteDatePhotosGroup[]> => {
        stubs.asked.push("days");
        return stubs.dayCounts.map((count, i) => ({
          id: i === 0 ? 20250816 : 1,
          date: i === 0 ? "2025-08-16" : null,
          location: "",
          incomplete: true,
          numberOfItems: count,
          items: [],
        }));
      },
      fetchGalleryDayPhotos: async (_client: unknown, day: number, page: number) => {
        stubs.asked.push(`day ${day} page ${page}`);
        return { count: 3, next: null, previous: null, results: [photo("a"), photo("b"), photo("c")] };
      },
    },
  };
});

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise(resolve => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/**
 * The timeline, then (as the photo list does once it has laid the days out) the page of `day`.
 */
async function render(client: QueryClient, filter: GalleryFilter, day: number) {
  function Host({ shownDay }: { shownDay: number }) {
    useGalleryDaysQuery(filter);
    useGalleryDayQuery(filter, shownDay, 1);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  const show = (shownDay: number) =>
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <Host shownDay={shownDay} />
        </QueryClientProvider>
      )
    );
  show(0);
  await flush();
  show(day);
  await flush();
  return root;
}

const timeline = (client: QueryClient, filter: GalleryFilter) =>
  defined(client.getQueryData<IncompleteDatePhotosGroup[]>(photoGridKeys.galleryDays(filter)));

describe("the gallery timeline's hooks", () => {
  it("fills a day's placeholders from its page, never past its count", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filter = { owner: 2 };
    stubs.dayCounts = [3, 1];
    await render(client, filter, 1);
    const [day, undated] = timeline(client, filter);
    expect(defined(day).items.every(item => item.isTemp)).toBe(true);
    // The undated group has one photo: one of the page's three fills it.
    expect(defined(undated).items.map(item => item.image_hash)).toEqual(["hash-a"]);
  });

  it("keeps the loaded pages when the timeline is fetched again", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filter = {};
    stubs.dayCounts = [3, 1];
    stubs.asked = [];
    await render(client, filter, 20250816);
    expect(timeline(client, filter)[0]?.items.map(item => item.image_hash)).toEqual(["hash-a", "hash-b", "hash-c"]);

    await act(async () => client.invalidateQueries({ queryKey: photoGridKeys.galleryDays(filter), exact: true }));
    await flush();
    expect(stubs.asked.filter(request => request === "days")).toHaveLength(2);
    expect(timeline(client, filter)[0]?.items.map(item => item.isTemp)).toEqual([false, false, false]);
  });

  it("asks for no day page before one is on screen", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    stubs.asked = [];
    await render(client, { place: "Munich" }, 0);
    expect(stubs.asked).toEqual(["days"]);
  });
});
