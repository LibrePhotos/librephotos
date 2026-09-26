/**
 * The remote sync data source, abstracted for injection/testing (mirrors the
 * Phase 1 `SeedSource` seam, but over the delta-sync endpoints). The delta
 * engine is written against this interface so the pull loop, tombstone
 * application, 410-reseed and integrity logic are all unit-tested under Node
 * with a fake source — no network, no fetch, no React.
 */
import { endpoints } from "@librephotos/api-client";
import type {
  ApiClient,
  SyncPullParams,
  SyncAutoAlbumsResponse,
  SyncCounts,
  SyncPersonsResponse,
  SyncPhotosResponse,
  SyncPlaceAlbumsResponse,
  SyncSharingResponse,
  SyncThingAlbumsResponse,
  SyncUserAlbumsResponse,
  SyncTagAlbumsResponse,
} from "@librephotos/api-client";

export type { SyncPullParams };

export interface RemoteSyncSource {
  photos(params: SyncPullParams): Promise<SyncPhotosResponse>;
  persons(params: SyncPullParams): Promise<SyncPersonsResponse>;
  userAlbums(params: SyncPullParams): Promise<SyncUserAlbumsResponse>;
  autoAlbums(params: SyncPullParams): Promise<SyncAutoAlbumsResponse>;
  thingAlbums(params: SyncPullParams): Promise<SyncThingAlbumsResponse>;
  placeAlbums(params: SyncPullParams): Promise<SyncPlaceAlbumsResponse>;
  tagAlbums(params: SyncPullParams): Promise<SyncTagAlbumsResponse>;
  sharing(params: SyncPullParams): Promise<SyncSharingResponse>;
  counts(): Promise<SyncCounts>;
}

/** Build a RemoteSyncSource backed by the api-client sync endpoints. */
export function createApiSyncSource(client: ApiClient): RemoteSyncSource {
  return {
    photos: (p) => endpoints.syncPhotos(client, p),
    persons: (p) => endpoints.syncPersons(client, p),
    userAlbums: (p) => endpoints.syncUserAlbums(client, p),
    autoAlbums: (p) => endpoints.syncAutoAlbums(client, p),
    thingAlbums: (p) => endpoints.syncThingAlbums(client, p),
    placeAlbums: (p) => endpoints.syncPlaceAlbums(client, p),
    tagAlbums: (p) => endpoints.syncTagAlbums(client, p),
    sharing: (p) => endpoints.syncSharing(client, p),
    counts: () => endpoints.syncCounts(client),
  };
}
