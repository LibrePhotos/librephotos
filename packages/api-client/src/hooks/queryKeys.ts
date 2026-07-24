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
  peopleAlbums: () => ["peopleAlbums"] as const,
  searchPhotos: (term: string) => ["searchPhotos", term] as const,
  siteSettings: () => ["siteSettings"] as const,
  jobs: () => ["jobs"] as const,
};
