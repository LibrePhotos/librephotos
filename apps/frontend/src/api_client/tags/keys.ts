// A tag's photos are a grid: photoGridKeys.tagAlbum (photos/keys.ts).
const root = ["tags"] as const;

export const tagKeys = {
  /** The tag list and every photo's tags. */
  all: root,
  list: () => [...root, "list"] as const,
  photo: (photoId: string) => [...root, "photo", photoId] as const,
};
