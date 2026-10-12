import { z } from "zod";
import { UserAlbumInfo } from "./albums";
import { PigPhoto, SimpleUser } from "./common";

/** Photos shared WITH me — a bare PigPhoto list carrying the owner. */
export const SharedToMePhotosResponse = z.object({
  results: PigPhoto.array(),
});
export type SharedToMePhotosResponse = z.infer<typeof SharedToMePhotosResponse>;

/** One photo shared to/from the current user (photos shared-by-me / with-me). */
export const SharedFromMePhoto = z.object({
  user_id: z.number(),
  user: SimpleUser,
  photo: PigPhoto,
});
export type SharedFromMePhoto = z.infer<typeof SharedFromMePhoto>;

export const SharedPhotosResponse = z.object({
  results: SharedFromMePhoto.array(),
});
export type SharedPhotosResponse = z.infer<typeof SharedPhotosResponse>;

/** Albums shared by-me / with-me reuse the UserAlbumInfo row shape. */
export const SharedAlbumsResponse = z.object({
  results: UserAlbumInfo.array(),
});
export type SharedAlbumsResponse = z.infer<typeof SharedAlbumsResponse>;

/** `POST /useralbum/makepublic`: the album's card with its new link settings. */
export const SetUserAlbumPublicResponse = z.object({
  status: z.boolean(),
  album: UserAlbumInfo,
});
export type SetUserAlbumPublicResponse = z.infer<typeof SetUserAlbumPublicResponse>;

/** The metadata sharing settings in effect for a public album or a photo link (all five are sent). */
export const PublicSharingSettings = z.object({
  share_location: z.boolean(),
  share_camera_info: z.boolean(),
  share_timestamps: z.boolean(),
  share_captions: z.boolean(),
  share_faces: z.boolean(),
});
export type PublicSharingSettings = z.infer<typeof PublicSharingSettings>;

/**
 * One photo of a public album, for a visitor: PublicPhotoDetailSerializer. What the album's
 * sharing settings leave out comes as null, "" or 0.
 */
export const PublicPhotoDetail = z.object({
  image_hash: z.string(),
  video: z.boolean(),
  square_thumbnail_url: z.string(),
  big_thumbnail_url: z.string(),
  small_square_thumbnail_url: z.string(),
  exif_timestamp: z.string().nullable().optional(),
  exif_gps_lat: z.number().nullable().optional(),
  exif_gps_lon: z.number().nullable().optional(),
  geolocation_json: z.record(z.string(), z.unknown()).nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  focal_length: z.number().nullable().optional(),
  fstop: z.number().nullable().optional(),
  iso: z.number().nullable().optional(),
  shutter_speed: z.string().nullable().optional(),
  // A null size (unknown to the metadata) failed the whole parse and left the
  // details panel empty. The server sends 0 for it now; null stays accepted.
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.string(), z.unknown()).optional(),
  people: z
    .object({
      name: z.string(),
      face_url: z.string().nullable(),
      face_id: z.number(),
    })
    .array()
    .optional(),
});
export type PublicPhotoDetail = z.infer<typeof PublicPhotoDetail>;

/** GET /public/albums/s/{slug}/photos/{id}/: the photo and the settings that filtered it. */
export const PublicPhotoDetailResponse = z.object({
  results: PublicPhotoDetail,
  sharing_settings: PublicSharingSettings,
});
export type PublicPhotoDetailResponse = z.infer<typeof PublicPhotoDetailResponse>;

/** A photo's public link (issue #2028): `enabled: false` with a null slug and url once revoked. */
export const PhotoShare = z.object({
  enabled: z.boolean(),
  slug: z.string().nullable(),
  url: z.string().nullable(),
  created_at: z.string().optional(),
  // Only in the list of links.
  photo_id: z.string().optional(),
  image_hash: z.string().optional(),
});
export type PhotoShare = z.infer<typeof PhotoShare>;

/** POST /photo/share: the link after the action. */
export const PhotoShareResponse = z.object({ status: z.boolean(), share: PhotoShare });
export type PhotoShareResponse = z.infer<typeof PhotoShareResponse>;

/** GET /photo/share/list: the user's active photo links, newest first. */
export const PhotoShareListResponse = z.object({ results: PhotoShare.array() });
export type PhotoShareListResponse = z.infer<typeof PhotoShareListResponse>;

/** What POST /photo/share does with a photo's link. */
export type PhotoShareAction = "enable" | "rotate" | "disable";

/**
 * What an anonymous visitor gets for /public/p/{slug}. Media come as slug-scoped URLs, so revoking
 * the link cuts them off too; there is no image hash.
 */
export const SharedPhoto = z.object({
  video: z.boolean(),
  thumbnail_url: z.string(),
  video_url: z.string().nullable(),
  // The canPlayType() string for a probed video (e.g. `video/mp4;
  // codecs="hvc1..."`); null for stills and unprobed videos. The public page
  // never transcodes, so it shows the fallback up front when this cannot play.
  video_playback_type: z.string().nullish(),
  exif_timestamp: z.string().nullable().optional(),
  search_location: z.string().optional(),
  camera: z.string().nullable().optional(),
  lens: z.string().nullable().optional(),
  search_captions: z.string().optional(),
  captions_json: z.record(z.string(), z.unknown()).optional(),
  people: z.array(z.object({ name: z.string() })).optional(),
});
export type SharedPhoto = z.infer<typeof SharedPhoto>;

/** GET /public/photo/{slug}/. */
export const SharedPhotoResponse = z.object({ results: SharedPhoto });
export type SharedPhotoResponse = z.infer<typeof SharedPhotoResponse>;

export type UpdatePhotoSharingParams = {
  image_hashes: string[];
  target_user_id: number;
  setSharing: boolean;
};

export type ShareUserAlbumParams = {
  id: number;
  shared_to: number;
  setSharing: boolean;
};
