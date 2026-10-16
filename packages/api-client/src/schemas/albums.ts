import { z } from "zod";
import { DatePhotosGroup, IncompleteDatePhotosGroup, IntegerId, PhotoHash, SimpleUser, UuidString } from "./common";
import { Person } from "./persons";

/* ---- Date albums (the timeline) ---------------------------------------- */

export const FetchDateAlbumsListResponse = z.object({
  results: IncompleteDatePhotosGroup.array(),
});
export type FetchDateAlbumsListResponse = z.infer<typeof FetchDateAlbumsListResponse>;

export const FetchDateAlbumResponse = z.object({
  results: IncompleteDatePhotosGroup,
});
export type FetchDateAlbumResponse = z.infer<typeof FetchDateAlbumResponse>;

/* ---- User albums ------------------------------------------------------- */

export const PhotoSuperSimple = z.object({
  image_hash: z.string(),
  exif_timestamp: z.string().nullable(),
  rating: z.number(),
  // PhotoSuperSimpleSerializer does not send it. Optional: zod 4 requires a z.unknown() key.
  geolocation_json: z.unknown().optional(),
  hidden: z.boolean(),
  public: z.boolean(),
  video: z.boolean(),
});
export type PhotoSuperSimple = z.infer<typeof PhotoSuperSimple>;

/**
 * A user album card's cover (AlbumUserListSerializer.get_cover_photo), a PhotoSuperSimple. An album
 * without a visible photo gets PhotoSuperSimpleSerializer(None).data instead: image_hash "" and
 * rating null. Only the hash and the video flag are required, what a card shows.
 */
const UserAlbumCover = PhotoHash.extend({
  exif_timestamp: z.string().nullable().optional(),
  rating: z.number().nullable().optional(),
  hidden: z.boolean().optional(),
  public: z.boolean().optional(),
});

/** Per-album overrides of the owner's public sharing defaults; null = use the default. */
export const PublicSharingOptions = z.object({
  share_location: z.boolean().nullable().optional(),
  share_camera_info: z.boolean().nullable().optional(),
  share_timestamps: z.boolean().nullable().optional(),
  share_captions: z.boolean().nullable().optional(),
  share_faces: z.boolean().nullable().optional(),
});
export type PublicSharingOptions = z.infer<typeof PublicSharingOptions>;

/** The metadata sharing settings in effect for a public album or a photo link (all five are sent). */
export const PublicSharingSettings = z.object({
  share_location: z.boolean(),
  share_camera_info: z.boolean(),
  share_timestamps: z.boolean(),
  share_captions: z.boolean(),
  share_faces: z.boolean(),
});
export type PublicSharingSettings = z.infer<typeof PublicSharingSettings>;

export const UserAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: UserAlbumCover.nullable(),
  photo_count: z.number(),
  /**
   * When the album's oldest visible photo was taken (an exif_timestamp), for sorting My Albums by
   * date (#620). Null for an album without a dated photo; absent from older servers.
   */
  first_photo_date: z.string().nullish(),
  owner: SimpleUser,
  shared_to: SimpleUser.array(),
  created_on: z.string(),
  favorited: z.boolean(),
  locked: z.boolean().optional().default(false),
  public: z.boolean().optional(),
  // Optional: backends before 1.3 do not send them.
  public_slug: z.string().optional(),
  public_expires_at: z.string().nullable().optional(),
  public_sharing_options: PublicSharingOptions.nullable().optional(),
  // The owner's collections holding the album (#1009); empty on someone else's album. Optional:
  // older servers do not send it.
  collection_ids: z.number().array().optional().default([]),
});
export type UserAlbumInfo = z.infer<typeof UserAlbumInfo>;

export const FetchUserAlbumsListResponse = z.object({
  results: UserAlbumInfo.array(),
});
export type FetchUserAlbumsListResponse = z.infer<typeof FetchUserAlbumsListResponse>;

const UserAlbumDetails = z.object({
  id: IntegerId,
  title: z.string(),
  owner: SimpleUser,
  // Public album responses omit the lock flag; they are already read-only.
  shared_to: SimpleUser.array().optional(),
  locked: z.boolean().default(false),
  date: z.string(),
  location: z.string().nullable(),
});

export const UserAlbum = UserAlbumDetails.extend({
  grouped_photos: DatePhotosGroup.array(),
  public: z.boolean().optional(),
  public_slug: z.string().optional(),
  public_expires_at: z.string().nullable().optional(),
  public_sharing_options: PublicSharingOptions.nullable().optional(),
  // The owner's collections holding the album (#1009). Absent from a public album and from older
  // servers.
  collection_ids: z.number().array().optional().default([]),
});
export type UserAlbum = z.infer<typeof UserAlbum>;

/** A public album: the owner's UserAlbum shape without the owner's collections, which stay private. */
export const PublicAlbum = UserAlbum.omit({ collection_ids: true });
export type PublicAlbum = z.infer<typeof PublicAlbum>;

/**
 * GET /public/albums/s/{slug}/: a public album by its link slug, for a visitor without a session,
 * and the settings that filtered it. Read with the owner's UserAlbum shape, whose owner-only fields
 * (sharing, lock, link settings) are optional and absent here.
 */
export const FetchPublicAlbumResponse = z.object({
  results: PublicAlbum,
  sharing_settings: PublicSharingSettings.optional(),
});
export type FetchPublicAlbumResponse = z.infer<typeof FetchPublicAlbumResponse>;

/** The same answer, read only for the id of the album that holds the slug. */
export const PublicAlbumSlugOwner = z.object({
  results: z.object({ id: IntegerId }),
});
export type PublicAlbumSlugOwner = z.infer<typeof PublicAlbumSlugOwner>;

export const FetchUserAlbumsSharedResponse = z.object({
  results: UserAlbumInfo.array(),
});
export type FetchUserAlbumsSharedResponse = z.infer<typeof FetchUserAlbumsSharedResponse>;

/* ---- Album collections (#1009) ----------------------------------------- */

/** A user's own grouping of their albums ("Travel", "Family"); an album can be in several. */
export const AlbumCollection = z.object({
  id: z.number(),
  name: z.string(),
});
export type AlbumCollection = z.infer<typeof AlbumCollection>;

export const AlbumCollectionListResponse = z.object({
  results: AlbumCollection.array(),
});
export type AlbumCollectionListResponse = z.infer<typeof AlbumCollectionListResponse>;

/** PUT /albums/user/{id}/collections/: the collections the album is in after the change. */
export const UserAlbumCollections = z.object({
  collection_ids: z.number().array(),
});
export type UserAlbumCollections = z.infer<typeof UserAlbumCollections>;

/* ---- Auto (event) albums ---------------------------------------------- */

/** The time-of-day keys an event title names (backend `TIME_OF_DAY`). */
export const EVENT_TIME_OF_DAY = ["early_morning", "morning", "afternoon", "evening"] as const;
export type EventTimeOfDay = (typeof EVENT_TIME_OF_DAY)[number];

/**
 * What an event's `title` is made of, so a client can word it in its own
 * language (#2235). The weekday and time of day are the first photo's wall
 * clock: read them from here, never from a timestamp in the viewer's zone.
 */
export const EventTitleParts = z.object({
  /** ISO weekday, Monday is 1. */
  weekday: z.number().int().min(1).max(7).nullable(),
  time_of_day: z.enum(EVENT_TIME_OF_DAY).nullable(),
  /** Whole days between the first and the last photo. */
  span_days: z.number(),
  /** The first and the last photo fall on different weekend days. */
  weekend: z.boolean(),
  /** At most two named people, most frequent first. */
  people: z.string().array(),
  /** At most two places, as the reverse geocoder named them. */
  places: z.string().array(),
  /** The album's grouping date (YYYY-MM-DD), for the "Album from" fallback. */
  date: z.string(),
});
export type EventTitleParts = z.infer<typeof EventTitleParts>;

export const AutoAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  /** Null until the album's title is regenerated; older backends lack it. */
  title_parts: EventTitleParts.nullish(),
  /**
   * The event's grouping key, about 12 hours before its first photo: not a date
   * to show. `start` (the first photo's exif_timestamp) is; older backends lack it.
   */
  timestamp: z.string(),
  start: z.string().nullish(),
  photos: PhotoHash,
  photo_count: z.number(),
  favorited: z.boolean(),
});
export type AutoAlbumInfo = z.infer<typeof AutoAlbumInfo>;

export const FetchAutoAlbumsListResponse = z.object({
  results: AutoAlbumInfo.array(),
});
export type FetchAutoAlbumsListResponse = z.infer<typeof FetchAutoAlbumsListResponse>;

export const PhotoSimple = z.object({
  id: UuidString,
  square_thumbnail: z.string(),
  image_hash: z.string(),
  exif_timestamp: z.string(),
  exif_gps_lat: z.number().nullable(),
  exif_gps_lon: z.number().nullable(),
  rating: z.number(),
  geolocation_json: z.unknown(),
  public: z.boolean(),
  video: z.boolean(),
  // What a grid tile needs beyond the hash, as the photo summaries carry it.
  // Optional: backends before 1.3 do not send them.
  aspectRatio: z.number().nullish(),
  dominantColor: z.string().nullish(),
  // Seconds as a string, "" for a photo (as in PigPhoto).
  video_length: z.string().optional(),
  is_hdr: z.boolean().optional(),
  // A video whose grid square is an animated clip, not a still (#649); older backends lack it.
  animated_preview: z.boolean().optional(),
});
export type PhotoSimple = z.infer<typeof PhotoSimple>;

export const AutoAlbum = z.object({
  id: z.number(),
  title: z.string(),
  /** Null until the album's title is regenerated; older backends lack it. */
  title_parts: EventTitleParts.nullish(),
  favorited: z.boolean(),
  timestamp: z.string(),
  created_on: z.string(),
  gps_lat: z.number().nullable(),
  gps_lon: z.number().nullable(),
  /** The people whose (non-deleted) faces appear in the album's photos. */
  people: Person.array(),
  photos: PhotoSimple.array(),
  /**
   * The id of the cover the owner picked (#429); null while the cover is automatic (the first
   * photo), also when the picked one was hidden or trashed since. Older backends lack it.
   */
  cover_photo: UuidString.nullish(),
});
export type AutoAlbum = z.infer<typeof AutoAlbum>;

/** PATCH /albums/auto/{id}/: the event's cover after the change. */
export const AutoAlbumEdit = z.object({
  id: z.number(),
  cover_photo: UuidString.nullable(),
});
export type AutoAlbumEdit = z.infer<typeof AutoAlbumEdit>;

/* ---- Thing / Place albums --------------------------------------------- */

export const AlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photos: PhotoHash.array(),
  photo_count: z.number(),
});
export type AlbumInfo = z.infer<typeof AlbumInfo>;

/** `thing_type` is where the label came from, e.g. "places365_attribute" or "hashtag_attribute". */
export const ThingAlbumInfo = AlbumInfo.extend({
  thing_type: z.string().nullable(),
});
export type ThingAlbumInfo = z.infer<typeof ThingAlbumInfo>;

export const FetchThingAlbumsListResponse = z.object({
  results: ThingAlbumInfo.array(),
});
export type FetchThingAlbumsListResponse = z.infer<typeof FetchThingAlbumsListResponse>;

export const ThingAlbum = z.object({
  id: IntegerId,
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type ThingAlbum = z.infer<typeof ThingAlbum>;

export const FetchThingAlbumResponse = z.object({
  results: ThingAlbum,
});
export type FetchThingAlbumResponse = z.infer<typeof FetchThingAlbumResponse>;

export const PlaceAlbumInfo = AlbumInfo.extend({
  geolocation_level: z.number(),
});
export type PlaceAlbumInfo = z.infer<typeof PlaceAlbumInfo>;

export const FetchPlaceAlbumsListResponse = z.object({
  results: PlaceAlbumInfo.array(),
});
export type FetchPlaceAlbumsListResponse = z.infer<typeof FetchPlaceAlbumsListResponse>;

export const PlaceAlbum = z.object({
  id: IntegerId,
  title: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type PlaceAlbum = z.infer<typeof PlaceAlbum>;

export const FetchPlaceAlbumResponse = z.object({
  results: PlaceAlbum,
});
export type FetchPlaceAlbumResponse = z.infer<typeof FetchPlaceAlbumResponse>;

/**
 * GET /locclust/: one row per geocoded place, `[lat, lon, name]` (api/dataviz/stats.py
 * get_location_clusters), for the Places map.
 */
export const LocationClusters = z.array(z.array(z.union([z.number(), z.string()])));
export type LocationClusters = z.infer<typeof LocationClusters>;

/* ---- Folders ------------------------------------------------------------ */

export const FolderSubfolder = z.object({
  name: z.string(),
  path: z.string(),
  photo_count: z.number(),
  /** The directory's mtime, in seconds. */
  modified: z.number(),
  /** The newest photo in and below it (#2233); older backends lack it. */
  cover_photo: PhotoHash.nullish(),
});
export type FolderSubfolder = z.infer<typeof FolderSubfolder>;

/**
 * GET /folders/subfolders/: one page of a folder's subfolders, the shared page envelope (backend
 * api/drf/pagination.py) plus the folder's own paths. The server still repeats the page as
 * `subfolders` and `pagination` for older web bundles; read `results` and `next`.
 */
export const FolderSubfoldersResponse = z.object({
  /** null, with an empty listing, for a user without a scan directory. */
  current_path: z.string().nullable(),
  parent_path: z.string().nullable(),
  results: FolderSubfolder.array(),
  count: z.number(),
  next: z.string().nullable(),
  previous: z.string().nullable(),
  page: z.number(),
  page_size: z.number(),
  num_pages: z.number(),
});
export type FolderSubfoldersResponse = z.infer<typeof FolderSubfoldersResponse>;

/** Every subfolder of a folder (all pages of GET /folders/subfolders/), with the folder's own paths. */
export type FolderSubfolderListing = Pick<FolderSubfoldersResponse, "current_path" | "parent_path" | "results">;

/* ---- Mutation params (platform-agnostic) ------------------------------ */

export type CreateUserAlbumParams = { title: string; photos: string[] };
export type DeleteUserAlbumParams = { id: string; albumTitle: string };
export type RenameUserAlbumParams = { id: string; title: string; newTitle: string };
export type AddPhotoToUserAlbumParams = { id: string; title: string; photos: string[] };
export type RemovePhotoFromUserAlbumParams = { id: string; title: string; photos: string[] };
