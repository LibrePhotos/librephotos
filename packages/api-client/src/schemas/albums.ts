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

export const UserAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: UserAlbumCover.nullable(),
  photo_count: z.number(),
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
});
export type UserAlbum = z.infer<typeof UserAlbum>;

/** GET /public/albums/s/{slug}/: a public album by its link slug, for a visitor without a session. */
export const FetchPublicAlbumResponse = z.object({
  results: UserAlbum,
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

/* ---- Auto (event) albums ---------------------------------------------- */

export const AutoAlbumInfo = z.object({
  id: z.number(),
  title: z.string(),
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
});
export type PhotoSimple = z.infer<typeof PhotoSimple>;

export const AutoAlbum = z.object({
  id: z.number(),
  title: z.string(),
  favorited: z.boolean(),
  timestamp: z.string(),
  created_on: z.string(),
  gps_lat: z.number().nullable(),
  gps_lon: z.number().nullable(),
  /** The people whose (non-deleted) faces appear in the album's photos. */
  people: Person.array(),
  photos: PhotoSimple.array(),
});
export type AutoAlbum = z.infer<typeof AutoAlbum>;

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
