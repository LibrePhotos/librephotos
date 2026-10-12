import { z } from "zod";
import { IntegerId } from "./common";

/**
 * Response schemas for the photo/album/person *mutation* endpoints (Phase 4
 * offline mutations). These are deliberately permissive (`z.looseObject`): the
 * client only needs to confirm success and, for album create, learn the new
 * server id — the authoritative row state is re-materialized by the next delta
 * pull, so we never depend on the exact mutation-response body.
 */

/** `/photosedit/{favorite,rating,hide,setdeleted}/` — bulk flag/rating updates. */
export const BulkPhotoMutationResponse = z.looseObject({
  status: z.boolean().optional(),
  count: z.number().optional(),
  updated_hashes: z.array(z.string()).optional(),
  not_updated_hashes: z.array(z.string()).optional(),
  // Older servers sent one serialized photo per entry instead of the hashes.
  updated: z.array(z.unknown()).optional(),
  not_updated: z.array(z.unknown()).optional(),
});
export type BulkPhotoMutationResponse = z.infer<typeof BulkPhotoMutationResponse>;

/** `PATCH /photos/edit/{hash}/` — single-photo field edit (timestamp, GPS). */
export const PhotoEditResponse = z.looseObject({
  image_hash: z.string().optional(),
  rating: z.number().optional(),
  hidden: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
});
export type PhotoEditResponse = z.infer<typeof PhotoEditResponse>;

/** `/photosedit/savecaption/` — plain status. */
export const StatusResponse = z.looseObject({ status: z.boolean().optional() });
export type StatusResponse = z.infer<typeof StatusResponse>;

/**
 * `POST /albums/user/edit/` create response. The one mutation response we read:
 * the newly-minted album id is swapped in for the client temp id on replay.
 */
export const CreateUserAlbumResponse = z.looseObject({
  id: z.number(),
  title: z.string().optional(),
});
export type CreateUserAlbumResponse = z.infer<typeof CreateUserAlbumResponse>;

/**
 * `PATCH /albums/user/edit/{id}/` (photos added or removed, cover, lock): AlbumUserEditSerializer,
 * as for create.
 */
export const UserAlbumEditResponse = z.looseObject({
  id: z.number(),
  title: z.string().optional(),
});
export type UserAlbumEditResponse = z.infer<typeof UserAlbumEditResponse>;

/** `PATCH /albums/user/{id}/` rename: AlbumUserSerializer, whose id is still a string (issue #389). */
export const UserAlbumRenameResponse = z.looseObject({
  id: IntegerId,
  title: z.string().optional(),
});
export type UserAlbumRenameResponse = z.infer<typeof UserAlbumRenameResponse>;

/** `PATCH /persons/{id}/` rename and cover: PersonSerializer. */
export const PersonEditResponse = z.looseObject({
  id: z.number(),
  name: z.string().optional(),
});
export type PersonEditResponse = z.infer<typeof PersonEditResponse>;
