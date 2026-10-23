import { z } from "zod";
import { DatePhotosGroup, IntegerId, PhotoHash } from "./common";

/** The icon a place shows with its name (`UserPlaceIcon` on the server). */
export const USER_PLACE_ICONS = ["pin", "home", "work", "school", "heart", "star"] as const;
export const UserPlaceIcon = z.enum(USER_PLACE_ICONS);
export type UserPlaceIcon = z.infer<typeof UserPlaceIcon>;

/**
 * One of my places (#1365): a circle I named, "Home" 150 m around a spot. Only its owner ever
 * reads it; `photo_count` and `cover_photos` are my visible photos taken inside it.
 */
export const UserPlace = z.object({
  id: IntegerId,
  name: z.string(),
  icon: UserPlaceIcon,
  center_lat: z.number(),
  center_lon: z.number(),
  radius_m: z.number(),
  use_in_titles: z.boolean(),
  photo_count: z.number(),
  cover_photos: PhotoHash.array(),
});
export type UserPlace = z.infer<typeof UserPlace>;

/** `GET /user-places/`, read whole with fetchAllPages. */
export const UserPlaceList = z.object({ results: UserPlace.array() });
export type UserPlaceList = z.infer<typeof UserPlaceList>;

/** Another of my places that shares photos with a circle being drawn. */
export const UserPlaceOverlap = z.object({
  id: IntegerId,
  name: z.string(),
  photo_count: z.number(),
  /** That place is the smaller one, so the photos inside both show it. */
  smaller: z.boolean(),
});
export type UserPlaceOverlap = z.infer<typeof UserPlaceOverlap>;

/** `GET /user-places/preview/`: what a circle being drawn would hold. */
export const UserPlacePreview = z.object({
  photo_count: z.number(),
  cover_photos: PhotoHash.array(),
  overlaps: UserPlaceOverlap.array(),
});
export type UserPlacePreview = z.infer<typeof UserPlacePreview>;

/** `GET /user-places/<id>/photos/`: a place's photos by day, newest first. */
export const UserPlacePhotos = z.object({
  id: IntegerId,
  name: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type UserPlacePhotos = z.infer<typeof UserPlacePhotos>;
