/**
 * The web hooks and the package's hooks (used by the mobile app) build their keys with the same
 * factories (#2347). Where both cache the same answer of the same request they share one cache
 * entry; where the web reshapes the answer (groups, sorts, adds placeholders), the package hook keys
 * its raw answer apart, under the same family, so a prefix invalidation still refreshes both.
 */
import {
  albumKeys,
  ApiClientProvider,
  authKeys,
  faceKeys,
  photoGridKeys,
  Photoset,
  useAutoAlbumsQuery,
  useDateAlbumQuery,
  useDateAlbumsQuery,
  useIncompleteFacesQuery,
  useJobsQuery as usePackageJobsQuery,
  usePeopleAlbumsQuery,
  usePhotoDetailsQuery,
  usePhotosWithoutLocationQuery,
  usePhotosWithoutTimestampQuery,
  usePlaceAlbumQuery,
  usePlaceAlbumsQuery,
  useRecentlyAddedPhotosQuery,
  userKeys,
  useSharedAlbumsByMeQuery,
  useSharedAlbumsWithMeQuery,
  useSharedPhotosByMeQuery,
  useSharedPhotosWithMeQuery,
  useSiteSettingsQuery,
  useTagAlbumQuery,
  useTagAlbumsQuery,
  useThingAlbumQuery,
  useThingAlbumsQuery,
  useUserAlbumsQuery,
  useUserListQuery,
  useUserSelfDetailsQuery,
  useWorkerAvailabilityQuery,
  type ApiClient,
} from "@librephotos/api-client";
import { QueryClient, QueryClientProvider, type QueryCache, type QueryKey } from "@tanstack/react-query";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useFetchAutoAlbumsQuery } from "./albums/hooks/useFetchAutoAlbumsQuery";
import { useFetchDateAlbumQuery } from "./albums/hooks/useFetchDateAlbumQuery";
import { useFetchDateAlbumsQuery } from "./albums/hooks/useFetchDateAlbumsQuery";
import { useFetchPeopleAlbumsQuery } from "./albums/hooks/useFetchPeopleAlbumsQuery";
import { useFetchPlaceAlbumQuery } from "./albums/hooks/useFetchPlaceAlbumQuery";
import { useFetchPlacesAlbumsQuery } from "./albums/hooks/useFetchPlacesAlbumsQuery";
import { useFetchSharedAlbumsByMeQuery } from "./albums/hooks/useFetchSharedAlbumsByMeQuery";
import { useFetchSharedAlbumsWithMeQuery } from "./albums/hooks/useFetchSharedAlbumsWithMeQuery";
import { useFetchThingsAlbumQuery } from "./albums/hooks/useFetchThingsAlbumQuery";
import { useFetchThingsAlbumsQuery } from "./albums/hooks/useFetchThingsAlbumsQuery";
import { useFetchUserAlbumsQuery } from "./albums/hooks/useFetchUserAlbumsQuery";
import { useFetchIncompleteFacesQuery } from "./faces/hooks/useFetchIncompleteFacesQuery";
import { useJobsQuery } from "./jobs/hooks/useJobsQuery";
import { useWorkerQuery } from "./jobs/hooks/useWorkerQuery";
import { useFetchPhotoDetailsQuery } from "./photos/hooks/useFetchPhotoDetailsQuery";
import { useFetchPhotosWithoutLocationQuery } from "./photos/hooks/useFetchPhotosWithoutLocationQuery";
import { useFetchPhotosWithoutTimestampQuery } from "./photos/hooks/useFetchPhotosWithoutTimestampQuery";
import { useFetchRecentlyAddedPhotosQuery } from "./photos/hooks/useFetchRecentlyAddedPhotosQuery";
import { useFetchSharedPhotosByMeQuery } from "./photos/hooks/useFetchSharedPhotosByMeQuery";
import { useFetchSharedPhotosWithMeQuery } from "./photos/hooks/useFetchSharedPhotosWithMeQuery";
import { useGetSettingsQuery } from "./settings/hooks/useGetSettingsQuery";
import { useFetchTagAlbumQuery } from "./tags/hooks/useFetchTagAlbumQuery";
import { useFetchTagsQuery } from "./tags/hooks/useFetchTagsQuery";
import { useFetchUserListQuery } from "./user/hooks/useFetchUserListQuery";
import { useFetchUserSelfDetailsQuery } from "./user/hooks/useFetchUserSelfDetailsQuery";

// No request ever answers: the queries stay pending, which is all a key needs.
const idleClient = vi.hoisted((): ApiClient => {
  const pending = <T,>(): Promise<T> => new Promise<T>(() => {});
  return {
    request: pending,
    get: pending,
    post: pending,
    patch: pending,
    delete: pending,
    getBlob: pending,
    resolveBaseUrl: () => "",
  };
});

vi.mock("./api", async importOriginal => ({
  ...(await importOriginal<typeof import("./api")>()),
  apiClient: idleClient,
}));

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const unmounts: (() => void)[] = [];
afterEach(() => {
  unmounts.splice(0).forEach(unmount => act(unmount));
});

// What a grid hook reads to know the photo order (#2712), signed out here: the token, and the user
// lookup it leaves disabled. Not part of the answer the two hooks share.
const ORDER_LOOKUPS = new Set([authKeys.accessToken(), userKeys.selfDetail("")].map(key => JSON.stringify(key)));
const answers = (cache: QueryCache) =>
  cache.getAll().filter(query => !ORDER_LOOKUPS.has(JSON.stringify(query.queryKey)));

/** Renders the web hook and the package hook side by side and returns the cache. */
async function renderBoth(webHook: () => unknown, packageHook: () => unknown) {
  const client = new QueryClient();
  function Host() {
    webHook();
    packageHook();
    return null;
  }
  const root = createRoot(document.createElement("div"));
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={idleClient}>
          <Host />
        </ApiClientProvider>
      </QueryClientProvider>
    );
  });
  unmounts.push(() => root.unmount());
  return client.getQueryCache();
}

describe("a web hook and the package hook for the same answer", () => {
  it.each<[string, () => unknown, () => unknown]>([
    ["the user list", () => useFetchUserListQuery(), () => useUserListQuery()],
    ["a user's details", () => useFetchUserSelfDetailsQuery("3"), () => useUserSelfDetailsQuery(3)],
    ["recently added", () => useFetchRecentlyAddedPhotosQuery(), () => useRecentlyAddedPhotosQuery()],
    ["a photo's details", () => useFetchPhotoDetailsQuery("abc"), () => usePhotoDetailsQuery("abc")],
    ["the user albums", () => useFetchUserAlbumsQuery(), () => useUserAlbumsQuery()],
    ["the event albums", () => useFetchAutoAlbumsQuery(), () => useAutoAlbumsQuery()],
    ["the thing albums", () => useFetchThingsAlbumsQuery(), () => useThingAlbumsQuery()],
    ["the place albums", () => useFetchPlacesAlbumsQuery(), () => usePlaceAlbumsQuery()],
    ["the tags", () => useFetchTagsQuery(), () => useTagAlbumsQuery()],
    ["a thing album", () => useFetchThingsAlbumQuery("5"), () => useThingAlbumQuery(5)],
    ["a place album", () => useFetchPlaceAlbumQuery("6"), () => usePlaceAlbumQuery(6)],
    ["a tag album", () => useFetchTagAlbumQuery("7"), () => useTagAlbumQuery(7)],
    ["photos without a date", () => useFetchPhotosWithoutTimestampQuery(2), () => usePhotosWithoutTimestampQuery(2)],
    ["photos without a location", () => useFetchPhotosWithoutLocationQuery(2), () => usePhotosWithoutLocationQuery(2)],
    ["the site settings", () => useGetSettingsQuery(), () => useSiteSettingsQuery()],
    ["a job list page", () => useJobsQuery({ page: 1, pageSize: 20 }), () => usePackageJobsQuery()],
    ["the worker", () => useWorkerQuery(), () => useWorkerAvailabilityQuery()],
    [
      "an unfiltered day page",
      () => useFetchDateAlbumQuery({ photosetType: Photoset.FAVORITES, album_date_id: 4, page: 1 }),
      () => useDateAlbumQuery(Photoset.FAVORITES, 4, 1),
    ],
  ])("shares one cache entry: %s", async (_name, webHook, packageHook) => {
    expect(answers(await renderBoth(webHook, packageHook))).toHaveLength(1);
  });
});

describe("a web hook that reshapes the answer and the package hook", () => {
  it.each<[string, () => unknown, () => unknown, QueryKey]>([
    [
      "the timeline",
      () => useFetchDateAlbumsQuery({ photosetType: Photoset.TIMESTAMP }),
      () => useDateAlbumsQuery(Photoset.TIMESTAMP),
      photoGridKeys.kind("dateAlbums"),
    ],
    ["the people", () => useFetchPeopleAlbumsQuery(), () => usePeopleAlbumsQuery(), albumKeys.peopleAlbums()],
    ["photos I shared", () => useFetchSharedPhotosByMeQuery(), () => useSharedPhotosByMeQuery(), photoGridKeys.all],
    [
      "photos shared with me",
      () => useFetchSharedPhotosWithMeQuery(),
      () => useSharedPhotosWithMeQuery(),
      photoGridKeys.all,
    ],
    [
      "albums I shared",
      () => useFetchSharedAlbumsByMeQuery(),
      () => useSharedAlbumsByMeQuery(),
      albumKeys.sharedByMe(),
    ],
    [
      "albums shared with me",
      () => useFetchSharedAlbumsWithMeQuery(),
      () => useSharedAlbumsWithMeQuery(),
      albumKeys.sharedWithMe(),
    ],
    [
      "the people with face counts",
      () => useFetchIncompleteFacesQuery({ inferred: false, orderBy: "confidence" }),
      () => useIncompleteFacesQuery(false),
      faceKeys.incomplete(),
    ],
  ])("keys them apart under one family: %s", async (_name, webHook, packageHook, family) => {
    const cache = await renderBoth(webHook, packageHook);
    expect(answers(cache)).toHaveLength(2);
    expect(cache.findAll({ queryKey: family })).toHaveLength(2);
  });
});
