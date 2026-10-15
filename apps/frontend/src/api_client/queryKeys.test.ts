/**
 * The web's query keys moved from src/api_client/<domain>/keys.ts into the package's factories
 * (packages/api-client/src/hooks/queryKeys.ts), which the mobile app's hooks use too (#2347). The
 * keys are not persisted, but every invalidation must keep hitting the queries it refreshed before.
 * `before` is the key the old web factory built, written out; `after` is the package factory's.
 */
import {
  albumKeys,
  authKeys,
  duplicateKeys,
  faceKeys,
  folderKeys,
  geocodeKeys,
  jobKeys,
  mediaKeys,
  memoryKeys,
  photoGridKeys,
  photoKeys,
  Photoset,
  searchKeys,
  serverKeys,
  serviceKeys,
  settingsKeys,
  stackKeys,
  statsKeys,
  tagKeys,
  userKeys,
} from "@librephotos/api-client";
import { hashKey, QueryClient, type QueryKey } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

type KeyPair = { before: QueryKey; after: QueryKey };
type Refresh = { mutation: string; invalidates: KeyPair[]; refreshes: string[] };
type Domain = { queries: Record<string, KeyPair>; refreshes: Refresh[] };

const faceRequest = { person: 4, page: 1, inferred: false, orderBy: "confidence" } as const;
const incompleteRequest = { inferred: true, orderBy: "date" } as const;
const jobRequest = { page: 1, pageSize: 10 };
const stackFilters = { stack_type: "burst" };

const domains: Record<string, Domain> = {
  albums: {
    queries: {
      useFetchUserAlbumsQuery: { before: ["albums", "user"], after: albumKeys.userAlbums() },
      useFetchAutoAlbumsQuery: { before: ["albums", "auto"], after: albumKeys.autoAlbums() },
      useFetchThingsAlbumsQuery: { before: ["albums", "things"], after: albumKeys.thingsAlbums() },
      useFetchPlacesAlbumsQuery: { before: ["albums", "places"], after: albumKeys.placesAlbums() },
      useFetchPeopleAlbumsQuery: { before: ["albums", "people"], after: albumKeys.peopleAlbums() },
      useFetchLocationClustersQuery: { before: ["albums", "locationClusters"], after: albumKeys.locationClusters() },
      useFetchSharedAlbumsByMeQuery: { before: ["albums", "sharedByMe"], after: albumKeys.sharedByMe() },
      useFetchSharedAlbumsWithMeQuery: { before: ["albums", "sharedWithMe"], after: albumKeys.sharedWithMe() },
      useFetchFolderAlbumsQuery: { before: ["albums", "folders", "page", "/a"], after: albumKeys.folder("/a") },
      useFetchFolderSubfoldersInfiniteQuery: {
        before: ["albums", "folders", "infinite", "/a"],
        after: albumKeys.folderPages("/a"),
      },
      useSlugAvailabilityQuery: { before: ["albums", "slugOwner", "summer"], after: albumKeys.slugOwner("summer") },
    },
    refreshes: [
      {
        mutation: "useShareUserAlbumMutation",
        invalidates: [
          { before: ["albums", "user"], after: albumKeys.userAlbums() },
          { before: ["photoGrid", "userAlbum", "7"], after: photoGridKeys.userAlbum("7") },
          { before: ["albums", "sharedByMe"], after: albumKeys.sharedByMe() },
          { before: ["albums", "sharedWithMe"], after: albumKeys.sharedWithMe() },
        ],
        refreshes: [
          "useFetchUserAlbumsQuery",
          "useFetchUserAlbumQuery",
          "useFetchSharedAlbumsByMeQuery",
          "useFetchSharedAlbumsWithMeQuery",
        ],
      },
      {
        // invalidateUserAlbumPhotos: the photos enter or leave Not in an album (#530).
        mutation: "useAddPhotoToUserAlbumMutation",
        invalidates: [
          { before: ["albums", "user"], after: albumKeys.userAlbums() },
          { before: ["photoGrid", "userAlbum", "7"], after: photoGridKeys.userAlbum("7") },
          { before: ["photoGrid", "notInAlbum"], after: photoGridKeys.kind("notInAlbum") },
        ],
        refreshes: ["useFetchUserAlbumsQuery", "useFetchUserAlbumQuery", "useFetchPhotosNotInAlbumQuery"],
      },
      {
        mutation: "useDeleteAutoAlbumMutation",
        invalidates: [
          { before: ["albums", "auto"], after: albumKeys.autoAlbums() },
          { before: ["photoGrid", "autoAlbum"], after: photoGridKeys.kind("autoAlbum") },
        ],
        refreshes: ["useFetchAutoAlbumsQuery", "useFetchAutoAlbumQuery"],
      },
    ],
  },
  auth: {
    queries: {
      useAccessToken: { before: ["auth", "accessToken"], after: authKeys.accessToken() },
      useIsAuthenticatedQuery: { before: ["auth", "isAuthenticated"], after: authKeys.isAuthenticated() },
      useIsFirstTimeSetupQuery: { before: ["auth", "firstTimeSetup"], after: authKeys.firstTimeSetup() },
      useSsoConfigQuery: { before: ["auth", "ssoConfig"], after: authKeys.ssoConfig() },
    },
    refreshes: [
      {
        mutation: "useSignUpMutation",
        invalidates: [
          { before: ["auth", "firstTimeSetup"], after: authKeys.firstTimeSetup() },
          { before: ["user", "list"], after: userKeys.list() },
        ],
        refreshes: ["useIsFirstTimeSetupQuery", "useFetchUserListQuery"],
      },
    ],
  },
  duplicates: {
    queries: {
      useDuplicatesQuery: {
        before: ["duplicates", "list", "exact_copy", "pending", 1, 20],
        after: duplicateKeys.list("exact_copy", "pending", 1, 20),
      },
      useDuplicateQuery: { before: ["duplicates", "detail", "d1"], after: duplicateKeys.detail("d1") },
      useDuplicateStatsQuery: { before: ["duplicates", "stats"], after: duplicateKeys.stats() },
    },
    refreshes: [
      {
        mutation: "useResolveDuplicateMutation",
        invalidates: [
          { before: ["duplicates", "detail", "d1"], after: duplicateKeys.detail("d1") },
          { before: ["duplicates"], after: duplicateKeys.all },
          { before: ["duplicates", "stats"], after: duplicateKeys.stats() },
        ],
        refreshes: ["useDuplicatesQuery", "useDuplicateQuery", "useDuplicateStatsQuery"],
      },
    ],
  },
  faces: {
    queries: {
      fetchFaces: { before: ["faces", "person", faceRequest], after: faceKeys.personFacePage(faceRequest) },
      useFetchIncompleteFacesQuery: {
        before: ["faces", "incomplete", incompleteRequest],
        after: faceKeys.incompleteList(incompleteRequest),
      },
      useClusterFacesQuery: { before: ["faces", "clusters"], after: faceKeys.clusters() },
    },
    refreshes: [
      {
        mutation: "useRenamePersonAlbumMutation",
        invalidates: [
          { before: ["albums", "people"], after: albumKeys.peopleAlbums() },
          { before: ["faces", "person"], after: faceKeys.personFaces() },
          { before: ["faces", "incomplete"], after: faceKeys.incomplete() },
          { before: ["stats", "counts"], after: statsKeys.counts() },
        ],
        refreshes: [
          "useFetchPeopleAlbumsQuery",
          "fetchFaces",
          "useFetchIncompleteFacesQuery",
          "useFetchCountStatsQuery",
        ],
      },
    ],
  },
  folders: {
    queries: {
      useFetchDirsQuery: { before: ["folders", "dirTree", "/data"], after: folderKeys.dirTree("/data") },
      useFetchNextcloudDirsQuery: { before: ["folders", "nextcloudDirs"], after: folderKeys.nextcloudDirs() },
    },
    refreshes: [
      {
        mutation: "useUpdateUserMutation",
        invalidates: [
          { before: ["user", "self"], after: userKeys.selfDetails() },
          { before: ["user", "list"], after: userKeys.list() },
          { before: ["folders", "nextcloudDirs"], after: folderKeys.nextcloudDirs() },
        ],
        refreshes: ["useFetchUserSelfDetailsQuery", "useFetchUserListQuery", "useFetchNextcloudDirsQuery"],
      },
    ],
  },
  geocode: {
    queries: {
      useGeocodeSearchQuery: { before: ["geocode", "search", "Berlin"], after: geocodeKeys.search("Berlin") },
    },
    refreshes: [
      {
        mutation: "the geocode family",
        invalidates: [{ before: ["geocode"], after: geocodeKeys.all }],
        refreshes: ["useGeocodeSearchQuery"],
      },
    ],
  },
  jobs: {
    queries: {
      useJobsQuery: { before: ["jobs", "list", jobRequest], after: jobKeys.list(jobRequest) },
      useJobQuery: { before: ["jobs", "detail", 12], after: jobKeys.detail(12) },
      useWorkerQuery: { before: ["worker"], after: jobKeys.worker() },
    },
    refreshes: [
      {
        mutation: "useCancelJobMutation",
        invalidates: [
          { before: ["jobs"], after: jobKeys.all },
          { before: ["worker"], after: jobKeys.worker() },
        ],
        refreshes: ["useJobsQuery", "useJobQuery", "useWorkerQuery"],
      },
    ],
  },
  media: {
    queries: {
      useMediaDiagnosticsQuery: { before: ["media", "diagnostics", "abc"], after: mediaKeys.diagnostics("abc") },
    },
    refreshes: [
      {
        mutation: "the media family",
        invalidates: [{ before: ["media"], after: mediaKeys.all }],
        refreshes: ["useMediaDiagnosticsQuery"],
      },
    ],
  },
  memories: {
    queries: { useMemoriesQuery: { before: ["memories", { size: 6 }], after: memoryKeys.list(6) } },
    refreshes: [
      {
        mutation: "the memories family",
        invalidates: [{ before: ["memories"], after: memoryKeys.all }],
        refreshes: ["useMemoriesQuery"],
      },
    ],
  },
  photos: {
    queries: {
      useFetchPhotoDetailsQuery: { before: ["photos", "details", "abc"], after: photoKeys.detail("abc") },
      useFetchPhotoAlbumsQuery: { before: ["photos", "albums", "abc"], after: photoKeys.albums("abc") },
      useFetchPhotoMetadataQuery: { before: ["photos", "metadata", "abc"], after: photoKeys.metadata("abc") },
      useFetchPublicPhotoDetailQuery: {
        before: ["photos", "publicDetail", "summer", "abc"],
        after: photoKeys.publicDetail("summer", "abc"),
      },
      usePhotoSharesQuery: { before: ["photos", "shares"], after: photoKeys.shares() },
      useSharedPhotoQuery: { before: ["photos", "sharedBySlug", "s1"], after: photoKeys.sharedBySlug("s1") },
      useFetchDateAlbumsQuery: {
        before: ["photoGrid", "dateAlbums", Photoset.TIMESTAMP, undefined, undefined, undefined, "all", "none"],
        after: photoGridKeys.dateAlbumList([Photoset.TIMESTAMP, undefined, undefined, undefined, "all", "none"]),
      },
      useFetchDateAlbumQuery: {
        before: ["photoGrid", "dateAlbum", Photoset.TIMESTAMP, 4, 1, undefined, undefined, undefined, "all", "none"],
        after: photoGridKeys.dateAlbumDay([Photoset.TIMESTAMP, undefined, undefined, undefined, "all", "none"], 4, 1),
      },
      useFetchRecentlyAddedPhotosQuery: {
        // Keyed by the media filter since #2216.
        before: ["photoGrid", "recentlyAdded", "all"],
        after: photoGridKeys.recentlyAddedView("all"),
      },
      useFetchUserAlbumQuery: {
        before: ["photoGrid", "userAlbum", "7", false, "", "all"],
        after: photoGridKeys.userAlbumView("7", false, "", "all"),
      },
      usePublicAlbumQuery: {
        before: ["photoGrid", "publicAlbum", "summer"],
        after: photoGridKeys.publicAlbum("summer"),
      },
      useFetchAutoAlbumQuery: { before: ["photoGrid", "autoAlbum", "8"], after: photoGridKeys.autoAlbum("8") },
      useFetchPlaceAlbumQuery: {
        before: ["photoGrid", "placeAlbum", "9", "videos"],
        after: photoGridKeys.placeAlbum("9", "videos"),
      },
      useFetchThingsAlbumQuery: {
        before: ["photoGrid", "thingsAlbum", "10", "all"],
        after: photoGridKeys.thingsAlbum("10", "all"),
      },
      useFetchTagAlbumQuery: {
        before: ["photoGrid", "tagAlbum", "11", "all"],
        after: photoGridKeys.tagAlbumView("11", "all"),
      },
      useSearchPhotosQuery: {
        before: ["photoGrid", "search", "beach", "all", "semantic"],
        after: photoGridKeys.search("beach", "all", "semantic"),
      },
      useFetchPhotosWithoutTimestampQuery: {
        // Keyed by the media filter since #2216.
        before: ["photoGrid", "withoutTimestamp", 2, "all"],
        after: photoGridKeys.withoutTimestamp(2, "all"),
      },
      useFetchPhotosWithoutLocationQuery: {
        before: ["photoGrid", "withoutLocation", 2, "all"],
        after: photoGridKeys.withoutLocation(2, "all"),
      },
      // New in #530, keyed like No timestamp.
      useFetchPhotosNotInAlbumQuery: {
        before: ["photoGrid", "notInAlbum", 2, "all"],
        after: photoGridKeys.notInAlbum(2, "all"),
      },
      // New in #2686: the Sharing overview's first public photos.
      useFetchMyPublicPhotosQuery: {
        before: ["photoGrid", "myPublicPhotos", 6],
        after: photoGridKeys.myPublicPhotos(6),
      },
      useFetchSharedPhotosByMeQuery: { before: ["photoGrid", "sharedByMe"], after: photoGridKeys.sharedByMe() },
      useFetchSharedPhotosWithMeQuery: { before: ["photoGrid", "sharedWithMe"], after: photoGridKeys.sharedWithMe() },
    },
    refreshes: [
      {
        // invalidatePhotoLists plus the photo's details.
        mutation: "useSetFavoritePhotosMutation",
        invalidates: [
          { before: ["photoGrid"], after: photoGridKeys.all },
          { before: ["photos", "details", "abc"], after: photoKeys.detail("abc") },
        ],
        refreshes: [
          "useFetchPhotoDetailsQuery",
          "useFetchDateAlbumsQuery",
          "useFetchDateAlbumQuery",
          "useFetchRecentlyAddedPhotosQuery",
          "useFetchUserAlbumQuery",
          "usePublicAlbumQuery",
          "useFetchAutoAlbumQuery",
          "useFetchPlaceAlbumQuery",
          "useFetchThingsAlbumQuery",
          "useFetchTagAlbumQuery",
          "useSearchPhotosQuery",
          "useFetchPhotosWithoutTimestampQuery",
          "useFetchPhotosWithoutLocationQuery",
          "useFetchPhotosNotInAlbumQuery",
          "useFetchMyPublicPhotosQuery",
          "useFetchSharedPhotosByMeQuery",
          "useFetchSharedPhotosWithMeQuery",
        ],
      },
      {
        mutation: "useRotatePhotosMutation",
        invalidates: [
          { before: ["photoGrid", "dateAlbums"], after: photoGridKeys.kind("dateAlbums") },
          { before: ["photoGrid", "dateAlbum"], after: photoGridKeys.kind("dateAlbum") },
          { before: ["photoGrid", "recentlyAdded"], after: photoGridKeys.recentlyAdded() },
          { before: ["photos", "details", "abc"], after: photoKeys.detail("abc") },
        ],
        refreshes: [
          "useFetchDateAlbumsQuery",
          "useFetchDateAlbumQuery",
          "useFetchRecentlyAddedPhotosQuery",
          "useFetchPhotoDetailsQuery",
        ],
      },
      {
        mutation: "usePhotoMetadataMutations",
        invalidates: [
          { before: ["photos", "metadata", "abc"], after: photoKeys.metadata("abc") },
          { before: ["photos", "details"], after: photoKeys.details() },
          { before: ["tags"], after: tagKeys.all },
        ],
        refreshes: [
          "useFetchPhotoMetadataQuery",
          "useFetchPhotoDetailsQuery",
          "useFetchTagsQuery",
          "useFetchPhotoTagsQuery",
        ],
      },
    ],
  },
  search: {
    queries: { useSearchExamplesQuery: { before: ["search", "examples"], after: searchKeys.examples() } },
    refreshes: [
      {
        mutation: "the search family",
        invalidates: [{ before: ["search"], after: searchKeys.all }],
        refreshes: ["useSearchExamplesQuery"],
      },
    ],
  },
  server: {
    queries: {
      useFetchImageTagQuery: { before: ["server", "imageTag"], after: serverKeys.imageTag() },
      useFetchServerLogsViewQuery: { before: ["server", "logs", 100], after: serverKeys.logs(100) },
      useFetchServerStatsQuery: { before: ["server", "stats"], after: serverKeys.stats() },
      useFetchStorageStatsQuery: { before: ["server", "storageStats"], after: serverKeys.storageStats() },
    },
    refreshes: [
      {
        mutation: "useScanPhotosMutation",
        invalidates: [
          { before: ["albums", "auto"], after: albumKeys.autoAlbums() },
          { before: ["jobs"], after: jobKeys.all },
          { before: ["worker"], after: jobKeys.worker() },
          { before: ["stats", "counts"], after: statsKeys.counts() },
          { before: ["stats", "photoMonthCounts"], after: statsKeys.photoMonthCounts() },
          { before: ["server", "stats"], after: serverKeys.stats() },
          { before: ["server", "storageStats"], after: serverKeys.storageStats() },
        ],
        refreshes: [
          "useFetchAutoAlbumsQuery",
          "useJobsQuery",
          "useJobQuery",
          "useWorkerQuery",
          "useFetchCountStatsQuery",
          "useFetchPhotoMonthCountQuery",
          "useFetchServerStatsQuery",
          "useFetchStorageStatsQuery",
        ],
      },
    ],
  },
  services: {
    queries: {
      useServicesQuery: { before: ["services", "list"], after: serviceKeys.list() },
      useServiceHealthQuery: {
        before: ["services", "health", ["clip", "thumbnail"]],
        after: serviceKeys.health(["clip", "thumbnail"]),
      },
    },
    refreshes: [
      {
        mutation: "useServiceActionMutation",
        invalidates: [{ before: ["services", "health"], after: serviceKeys.healths() }],
        refreshes: ["useServiceHealthQuery"],
      },
    ],
  },
  settings: {
    queries: {
      useGetSettingsQuery: { before: ["settings", "site"], after: settingsKeys.site() },
      useEmailConfig: { before: ["settings", "emailConfig"], after: settingsKeys.emailConfig() },
      useFetchPredefinedBurstRulesQuery: {
        before: ["settings", "predefinedBurstRules"],
        after: settingsKeys.predefinedBurstRules(),
      },
      useFetchPredefinedRulesQuery: { before: ["settings", "predefinedRules"], after: settingsKeys.predefinedRules() },
      useFetchTimezonesQuery: { before: ["settings", "timezones"], after: settingsKeys.timezones() },
    },
    refreshes: [
      {
        mutation: "useUpdateEmailConfigMutation",
        invalidates: [
          { before: ["settings", "emailConfig"], after: settingsKeys.emailConfig() },
          { before: ["settings", "site"], after: settingsKeys.site() },
        ],
        refreshes: ["useEmailConfig", "useGetSettingsQuery"],
      },
    ],
  },
  stacks: {
    queries: {
      useStacksQuery: { before: ["stacks", "list", stackFilters], after: stackKeys.list(stackFilters) },
      useStackQuery: { before: ["stacks", "detail", "s1"], after: stackKeys.detail("s1") },
      useStackStatsQuery: { before: ["stacks", "stats"], after: stackKeys.stats() },
    },
    refreshes: [
      {
        mutation: "useRemoveFromStackMutation",
        invalidates: [
          { before: ["stacks", "detail", "s1"], after: stackKeys.detail("s1") },
          { before: ["stacks", "list"], after: stackKeys.lists() },
          { before: ["stacks", "stats"], after: stackKeys.stats() },
        ],
        refreshes: ["useStacksQuery", "useStackQuery", "useStackStatsQuery"],
      },
    ],
  },
  stats: {
    queries: {
      useFetchCountStatsQuery: { before: ["stats", "counts"], after: statsKeys.counts() },
      useFetchPhotoMonthCountQuery: { before: ["stats", "photoMonthCounts"], after: statsKeys.photoMonthCounts() },
      useFetchLocationTreeQuery: { before: ["stats", "locationTree"], after: statsKeys.locationTree() },
      useFetchSocialGraphQuery: { before: ["stats", "socialGraph"], after: statsKeys.socialGraph() },
      useFetchWordCloudQuery: { before: ["stats", "wordCloud"], after: statsKeys.wordCloud() },
      useLocationTimelineQuery: { before: ["stats", "locationTimeline"], after: statsKeys.locationTimeline() },
    },
    refreshes: [
      {
        mutation: "useSetPhotosHiddenMutation",
        invalidates: [
          { before: ["faces", "incomplete"], after: faceKeys.incomplete() },
          { before: ["stats", "counts"], after: statsKeys.counts() },
          { before: ["stats", "photoMonthCounts"], after: statsKeys.photoMonthCounts() },
        ],
        refreshes: ["useFetchIncompleteFacesQuery", "useFetchCountStatsQuery", "useFetchPhotoMonthCountQuery"],
      },
    ],
  },
  tags: {
    queries: {
      useFetchTagsQuery: { before: ["tags", "list"], after: tagKeys.list() },
      useFetchPhotoTagsQuery: { before: ["tags", "photo", "abc"], after: tagKeys.photo("abc") },
    },
    refreshes: [
      {
        mutation: "useRenameTagMutation",
        invalidates: [
          { before: ["tags"], after: tagKeys.all },
          { before: ["photoGrid", "tagAlbum", "11"], after: photoGridKeys.tagAlbum("11") },
        ],
        refreshes: ["useFetchTagsQuery", "useFetchPhotoTagsQuery", "useFetchTagAlbumQuery"],
      },
    ],
  },
  user: {
    queries: {
      useFetchUserListQuery: { before: ["user", "list"], after: userKeys.list() },
      useFetchUserSelfDetailsQuery: { before: ["user", "self", "3"], after: userKeys.selfDetail("3") },
    },
    refreshes: [
      {
        mutation: "useUpdateAvatarMutation",
        invalidates: [
          { before: ["user", "self"], after: userKeys.selfDetails() },
          { before: ["user", "list"], after: userKeys.list() },
        ],
        refreshes: ["useFetchUserSelfDetailsQuery", "useFetchUserListQuery"],
      },
    ],
  },
};

/** A cache holding every query of every domain under its old key, and the query each hash belongs to. */
function cacheWithEveryQuery() {
  const client = new QueryClient();
  const names = new Map<string, string>();
  for (const { queries } of Object.values(domains)) {
    for (const [name, { before }] of Object.entries(queries)) {
      client.setQueryData(before, 0);
      names.set(hashKey(before), name);
    }
  }
  const matched = (queryKey: QueryKey) =>
    client
      .getQueryCache()
      .findAll({ queryKey })
      .map(query => names.get(query.queryHash) ?? query.queryHash)
      .sort();
  return { client, matched };
}

describe.each(Object.entries(domains))("%s keys", (_domain, { queries, refreshes }) => {
  it.each(Object.entries(queries))("%s keeps its key", (_name, { before, after }) => {
    expect(hashKey(after)).toBe(hashKey(before));
  });

  it.each(refreshes.map(refresh => [refresh.mutation, refresh] as const))(
    "%s refreshes the queries it refreshed before",
    (_mutation, { invalidates, refreshes: expected }) => {
      const { matched } = cacheWithEveryQuery();
      for (const { before, after } of invalidates) {
        expect(matched(after), JSON.stringify(after)).toEqual(matched(before));
      }
      const refreshed = new Set(invalidates.flatMap(({ after }) => matched(after)));
      expect([...refreshed].sort()).toEqual([...expected].sort());
    }
  );
});

describe("photoGridKeys.all", () => {
  it("covers every photo grid, the package hooks' raw grids included, and nothing else", () => {
    const { client, matched } = cacheWithEveryQuery();
    const raw = [
      photoGridKeys.dateAlbumListRaw(Photoset.FAVORITES),
      photoGridKeys.sharedByMeRaw(),
      photoGridKeys.sharedWithMeRaw(),
    ];
    raw.forEach(queryKey => client.setQueryData(queryKey, 0));

    const grids = Object.entries(domains.photos?.queries ?? {})
      .filter(([, { before }]) => before[0] === "photoGrid")
      .map(([name]) => name);
    // One query per grid kind.
    expect(grids).toHaveLength(16);
    expect(matched(photoGridKeys.all)).toEqual([...grids, ...raw.map(queryKey => hashKey(queryKey))].sort());
  });
});
