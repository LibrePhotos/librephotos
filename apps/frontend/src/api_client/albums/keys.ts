// The album lists and pickers. An album's photos are a grid: photoGridKeys (photos/keys.ts).
const root = ["albums"] as const;

export const albumKeys = {
  all: root,
  userAlbums: () => [...root, "user"] as const,
  autoAlbums: () => [...root, "auto"] as const,
  thingsAlbums: () => [...root, "things"] as const,
  placesAlbums: () => [...root, "places"] as const,
  peopleAlbums: () => [...root, "people"] as const,
  locationClusters: () => [...root, "locationClusters"] as const,
  sharedByMe: () => [...root, "sharedByMe"] as const,
  sharedWithMe: () => [...root, "sharedWithMe"] as const,
  /** Every folder listing, paged or not. */
  folders: () => [...root, "folders"] as const,
  folder: (path: string | undefined) => [...albumKeys.folders(), "page", path] as const,
  folderPages: (path: string | undefined) => [...albumKeys.folders(), "infinite", path] as const,
  /** Which album, if any, already uses a public link slug. */
  slugOwner: (slug: string) => [...root, "slugOwner", slug] as const,
};
