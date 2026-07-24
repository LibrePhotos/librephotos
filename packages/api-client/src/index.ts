/**
 * @librephotos/api-client
 *
 * Platform-agnostic LibrePhotos API client shared between apps/frontend and
 * apps/mobile-v2. Three layers:
 *   - schemas/   zod schemas = single source of truth for API types
 *   - transport/ React-free injectable fetch client with refresh interceptor
 *   - endpoints/ thin typed wrappers over the transport
 *   - hooks/     TanStack Query v5 hooks (the only React surface)
 *
 * The `media` helper builds thumbnail/original URLs from an image hash; on
 * mobile these are fetched with an Authorization header (expo-image), on web
 * they ride same-origin cookies.
 */
export * from "./schemas";
export * from "./transport";
export * as endpoints from "./endpoints";
// Endpoint parameter types that callers need at the top level.
export type { DateAlbumFilter } from "./endpoints";
export * from "./hooks";
export * from "./media";
