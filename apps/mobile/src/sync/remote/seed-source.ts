/**
 * The real api-client-backed SeedSource (app runtime). Kept separate from
 * seed.ts so the seed orchestration stays React/api-client-value-free and
 * unit-testable under Node with a fake source.
 */
import type { ApiClient } from "@librephotos/api-client";
import { endpoints } from "@librephotos/api-client";
import type { SeedSource } from "./seed";

/** Build a SeedSource backed by the existing api-client endpoints. */
export function createApiSeedSource(client: ApiClient): SeedSource {
  return {
    days: (filter) => endpoints.fetchDays(client, filter),
    dayPhotos: (id, after, filter) => endpoints.fetchDayPhotos(client, id, after, filter),
    photosWithoutTimestamp: (page) => endpoints.fetchPhotosWithoutTimestamp(client, page),
    people: () => endpoints.fetchPeopleAlbums(client),
    userAlbumsList: () => endpoints.fetchUserAlbumsList(client),
    userAlbum: (id) => endpoints.fetchUserAlbum(client, id),
    autoAlbumsList: () => endpoints.fetchAutoAlbumsList(client),
    autoAlbum: (id) => endpoints.fetchAutoAlbum(client, id),
    thingAlbumsList: () => endpoints.fetchThingAlbumsList(client),
    placeAlbumsList: () => endpoints.fetchPlaceAlbumsList(client),
    tagAlbumsList: () => endpoints.fetchTagAlbumsList(client),
  };
}
