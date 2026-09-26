import { z } from "zod";

/**
 * Response schemas for the photo/album/person *mutation* endpoints (Phase 4
 * offline mutations). These are deliberately permissive (`.passthrough()`): the
 * client only needs to confirm success and, for album create, learn the new
 * server id — the authoritative row state is re-materialized by the next delta
 * pull, so we never depend on the exact mutation-response body.
 */

/** `/photosedit/{favorite,hide,setdeleted}/` — bulk flag toggles. */
export const BulkPhotoMutationResponse = z
  .object({
    status: z.boolean().optional(),
    count: z.number().optional(),
    updated: z.array(z.unknown()).optional(),
    not_updated: z.array(z.unknown()).optional(),
  })
  .passthrough();
export type BulkPhotoMutationResponse = z.infer<typeof BulkPhotoMutationResponse>;

/** `PATCH /photos/edit/{hash}/` — single-photo field edit (rating, etc.). */
export const PhotoEditResponse = z
  .object({
    image_hash: z.string().optional(),
    rating: z.number().optional(),
    hidden: z.boolean().optional(),
    in_trashcan: z.boolean().optional(),
  })
  .passthrough();
export type PhotoEditResponse = z.infer<typeof PhotoEditResponse>;

/** `/photosedit/savecaption/` and person/album renames — plain status. */
export const StatusResponse = z.object({ status: z.boolean().optional() }).passthrough();
export type StatusResponse = z.infer<typeof StatusResponse>;

/**
 * `POST /albums/user/edit/` create response. The one mutation response we read:
 * the newly-minted album id is swapped in for the client temp id on replay.
 */
export const CreateUserAlbumResponse = z
  .object({
    id: z.number(),
    title: z.string().optional(),
  })
  .passthrough();
export type CreateUserAlbumResponse = z.infer<typeof CreateUserAlbumResponse>;
