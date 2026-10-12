import type { SelectAllPhotos } from "@librephotos/api-client";

// The tag schemas are shared with the mobile app and live in packages/api-client.
export type {
  CreateTagParams,
  DeleteTagParams,
  RenameTagParams,
  TagList,
  TagPhotosParams,
} from "@librephotos/api-client";

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
