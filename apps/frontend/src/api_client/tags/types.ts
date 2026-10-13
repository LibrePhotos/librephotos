import type { SelectAllPhotos } from "@librephotos/api-client";

// The web's tag hook parameters. The tag schemas and the other parameter types are in
// @librephotos/api-client.

export type MergeTagsParams = {
  id: number;
  name: string;
  sourceId: number;
  sourceName: string;
};

export type TagPhotosByNameParams = {
  /** Tag names as typed, comma-separated entry already split. */
  names: string[];
  /** Explicit photo ids or image hashes. Ignored when selectAll is given. */
  photos?: string[];
  /** The query behind the photoset, minus what was unchecked. */
  selectAll?: SelectAllPhotos;
  /** How many photos the caller believes it is tagging, for the toast. */
  photoCount: number;
};
