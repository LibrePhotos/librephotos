/**
 * The React-free part of @librephotos/api-client (`@librephotos/api-client/core`): schemas,
 * transport (with native transports, transport/native.ts), endpoints and media URLs, without the
 * TanStack Query hooks and the polling helpers. For a client that does not use React Query, such
 * as the desktop app; it needs only zod. The main entry re-exports all of it.
 */
export * from "./schemas";
export * from "./transport";
export * as endpoints from "./endpoints";
// Endpoint parameter types that callers need at the top level.
export type {
  AlbumMediaFilter,
  CheckFileContentsScope,
  DateAlbumFilter,
  DateTimeChange,
  MapBounds,
  PhotoCategory,
  SearchFilters,
  SelectAllPhotos,
  SharedGroupKind,
  SyncPullParams,
  UserAlbumOptions,
  UserPlaceCircle,
  UserPlaceFields,
} from "./endpoints";
export * from "./media";
export { ResponseParseError, type ParsedEntries } from "./util/parse";
