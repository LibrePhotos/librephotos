import { z } from "zod";
import { IntegerId } from "./common";

/**
 * Response schemas for the photo/album/person *mutation* endpoints (Phase 4
 * offline mutations). These are deliberately permissive (`z.looseObject`): the
 * client only needs to confirm success and, for album create, learn the new
 * server id — the authoritative row state is re-materialized by the next delta
 * pull, so we never depend on the exact mutation-response body.
 */

/**
 * `/photosedit/{favorite,rating,hide,setdeleted,makepublic,category,share}/` — bulk flag, rating,
 * category and sharing updates. `count` is the photos changed; for hashes (not select-all) the
 * flag views also list which hashes changed and which already had the value.
 */
export const BulkPhotoMutationResponse = z.looseObject({
  status: z.boolean().optional(),
  count: z.number().optional(),
  updated_hashes: z.array(z.string()).optional(),
  not_updated_hashes: z.array(z.string()).optional(),
});
export type BulkPhotoMutationResponse = z.infer<typeof BulkPhotoMutationResponse>;

/**
 * `POST /photosedit/datetime/` (#2278): the photos that got the new date, and those a shift left
 * alone because they have no date.
 */
export const SetPhotosDateTimeResponse = z.object({
  count: z.number(),
  skipped_without_date: z.number(),
});
export type SetPhotosDateTimeResponse = z.infer<typeof SetPhotosDateTimeResponse>;

/** One photo of a selection and its date (`exif_timestamp`, wall clock tagged UTC). */
export const DatedPhoto = z.object({
  image_hash: z.string(),
  exif_timestamp: z.string(),
});
export type DatedPhoto = z.infer<typeof DatedPhoto>;

/**
 * `POST /photos/date-summary/` (#2278): how many photos a selection has, how many have no date, and
 * its oldest and newest dated photo (null when none has a date), for the date dialog's preview.
 */
export const DateSummary = z.object({
  count: z.number(),
  without_date: z.number(),
  oldest: DatedPhoto.nullable(),
  newest: DatedPhoto.nullable(),
});
export type DateSummary = z.infer<typeof DateSummary>;

/**
 * `PATCH /photos/edit/{hash}/` — single-photo field edit (timestamp, GPS). PhotoEditSerializer
 * always sends the hash; the web refreshes the photo's details by it.
 */
export const PhotoEditResponse = z.looseObject({
  image_hash: z.string(),
  rating: z.number().optional(),
  hidden: z.boolean().optional(),
  in_trashcan: z.boolean().optional(),
  // False when a location edit kept the coordinates but found no place name for them (#2253).
  // Older servers do not send it.
  geocoded: z.boolean().optional(),
  // Why there is no place name (#2589): "no_place" when the lookup worked but there is none at the
  // position (open sea), "failed" when it was not looked up. Null without a position; older servers
  // do not send it.
  geocode_status: z.enum(["found", "no_place", "failed"]).nullable().optional(),
});
export type PhotoEditResponse = z.infer<typeof PhotoEditResponse>;

/**
 * `DELETE /photosedit/delete/` (photos in the trash deleted for good). For hashes: the hashes
 * deleted (`deleted`, also as `results`) and those that were not; for select-all: `count` and
 * `failed_count`.
 */
export const DeletePhotosResponse = z.looseObject({
  status: z.boolean(),
  results: z.string().array().optional(),
  deleted: z.string().array().optional(),
  not_deleted: z.string().array().optional(),
  count: z.number().optional(),
  failed_count: z.number().optional(),
});
export type DeletePhotosResponse = z.infer<typeof DeletePhotosResponse>;

/**
 * `POST /photosedit/rotate/`: the photo's new orientation. A refused rotation is a 4xx/5xx (the
 * error envelope), so a 2xx is always a done rotation.
 */
export const RotatePhotoResponse = z.object({
  status: z.literal(true),
  image_hash: z.string(),
  /** Numbered 1-8 like EXIF Orientation, but 6 (a turn left) and 8 (right) render swapped (#2595). */
  local_orientation: z.number(),
  last_modified: z.string(),
  /**
   * Why the edit, saved in LibrePhotos, did not reach the file or its sidecar (read-only library, a
   * HEIC/RAW original); null when it was written or writing is off. Optional: older servers omit it.
   */
  write_error: z.string().nullable().optional(),
});
export type RotatePhotoResponse = z.infer<typeof RotatePhotoResponse>;

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

/** `PATCH /albums/user/{id}/` rename: AlbumUserSerializer, whose id servers before #389 send as a string. */
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
