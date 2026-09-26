import type { Photoset } from "../schemas";

/** Centralized query-key factory so screens and mutations invalidate consistently. */
export const queryKeys = {
  userSelfDetails: (userId: string | number) => ["userSelfDetails", userId] as const,
  userList: () => ["userList"] as const,
  dateAlbums: (photoset: Photoset) => ["dateAlbums", photoset] as const,
  dateAlbum: (photoset: Photoset, albumDateId: string, page: number) =>
    ["dateAlbum", photoset, albumDateId, page] as const,
  recentlyAddedPhotos: () => ["recentlyAddedPhotos"] as const,
  photoDetails: (imageHash: string) => ["photoDetails", imageHash] as const,
  userAlbums: () => ["userAlbums"] as const,
  autoAlbums: () => ["autoAlbums"] as const,
  thingAlbums: () => ["thingAlbums"] as const,
  placeAlbums: () => ["placeAlbums"] as const,
  tagAlbums: () => ["tagAlbums"] as const,
  thingAlbum: (id: string | number) => ["thingAlbum", id] as const,
  placeAlbum: (id: string | number) => ["placeAlbum", id] as const,
  tagAlbum: (id: string | number) => ["tagAlbum", id] as const,
  peopleAlbums: () => ["peopleAlbums"] as const,
  photosWithoutTimestamp: (page: number) => ["photosWithoutTimestamp", page] as const,
  searchPhotos: (term: string) => ["searchPhotos", term] as const,
  siteSettings: () => ["siteSettings"] as const,
  jobs: () => ["jobs"] as const,
  workerAvailability: () => ["workerAvailability"] as const,
  sharedPhotosByMe: () => ["sharedPhotosByMe"] as const,
  sharedPhotosWithMe: () => ["sharedPhotosWithMe"] as const,
  sharedAlbumsByMe: () => ["sharedAlbumsByMe"] as const,
  sharedAlbumsWithMe: () => ["sharedAlbumsWithMe"] as const,
  faces: (person: number, inferred: boolean, page: number) =>
    ["faces", person, inferred, page] as const,
  incompleteFaces: (inferred: boolean) => ["incompleteFaces", inferred] as const,
};
