import type { BulkPhotoQuery, PigPhoto } from "@librephotos/api-client";

// The photo and photo-grid schemas are shared with the mobile app and live in
// packages/api-client; this module re-exports them under their old names.
export {
  BulkPhotoQuery,
  DatePhotosGroup,
  FileVariant,
  IncompleteDatePhotosGroup,
  Media,
  Photo,
  PhotoMetadata,
  PhotoOcrBlock,
  PhotoPerson,
  PhotoShare,
  Photoset,
  PhotoStackDetail,
  PigPhoto,
  SharedPhoto,
  SimpleUser,
  StackTypeEnum,
} from "@librephotos/api-client";

// Selection state for photolist components
export type SelectionState = {
  selectedItems: PigPhoto[];
  selectMode: boolean;
  // Server-side select all support
  selectAllMode: boolean;
  selectAllQuery?: BulkPhotoQuery;
  // Total count of photos for display in select all mode
  totalCount?: number;
};
