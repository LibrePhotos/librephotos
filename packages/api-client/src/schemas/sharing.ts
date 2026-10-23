import { z } from "zod";
import { PublicSharingSettings, UserAlbumInfo } from "./albums";
import { IntegerId, PigPhoto, SimpleUser } from "./common";
import { PhotoRights } from "./photoRights";

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

/** One of the up to four newest photos a "Shared with you" place or thing shows. */
export const SharedGroupCover = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});
export type SharedGroupCover = z.infer<typeof SharedGroupCover>;

/**
 * A place or thing of the photos shared with me (#2721): one entry per title, owners merged.
 * The count and covers come from those photos only.
 */
export const SharedGroup = z.object({
  title: z.string(),
  photo_count: z.number(),
  cover_photos: SharedGroupCover.array(),
});
export type SharedGroup = z.infer<typeof SharedGroup>;

export const SharedGroupsResponse = z.object({
  results: SharedGroup.array(),
});
export type SharedGroupsResponse = z.infer<typeof SharedGroupsResponse>;

/**
 * A person an owner named, on photos they shared with me (#2722): one entry per owner and
 * person. Only owners who share people's names are listed.
 */
export const SharedPerson = z.object({
  id: IntegerId,
  name: z.string(),
  owner: SimpleUser,
  photo_count: z.number(),
  face_url: z.string().nullable(),
});
export type SharedPerson = z.infer<typeof SharedPerson>;

export const SharedPeopleResponse = z.object({
  results: SharedPerson.array(),
});
export type SharedPeopleResponse = z.infer<typeof SharedPeopleResponse>;

/**
 * A whole library shared read-only (#2731), as either side sees it. The owner sets the `share_*`
 * switches (all off by default); the recipient sets `show_in_timeline`. `photo_count` is what the
 * share holds: the owner's photos and videos, never the hidden or trashed ones.
 */
export const LibraryShare = z.object({
  id: IntegerId,
  owner: SimpleUser,
  recipient: SimpleUser,
  show_in_timeline: z.boolean(),
  share_location: z.boolean(),
  share_faces: z.boolean(),
  share_camera_info: z.boolean(),
  share_captions: z.boolean(),
  share_originals: z.boolean(),
  created_at: z.string(),
  photo_count: z.number(),
});
export type LibraryShare = z.infer<typeof LibraryShare>;

export const LibrarySharesResponse = z.object({
  results: LibraryShare.array(),
});
export type LibrarySharesResponse = z.infer<typeof LibrarySharesResponse>;

/** The owner's switches of a library share, as the share dialog sends them. */
export type LibraryShareSwitches = Pick<
  LibraryShare,
  "share_location" | "share_faces" | "share_camera_info" | "share_captions" | "share_originals"
>;

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
  // Copyright, creator and license (#425), whatever the sharing settings; null without any.
  // Optional: older servers do not send it.
  rights: PhotoRights.nullable().optional(),
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
  // Only while the link is enabled.
  created_at: z.string().optional(),
});
export type PhotoShare = z.infer<typeof PhotoShare>;

/** One of the user's live photo links, with the photo it shares. */
export const PhotoShareLink = PhotoShare.extend({
  slug: z.string(),
  url: z.string(),
  created_at: z.string(),
  photo_id: z.string(),
  image_hash: z.string(),
});
export type PhotoShareLink = z.infer<typeof PhotoShareLink>;

/** POST /photo/share: the link after the action. */
export const PhotoShareResponse = z.object({ status: z.boolean(), share: PhotoShare });
export type PhotoShareResponse = z.infer<typeof PhotoShareResponse>;

/** GET /photo/share/list: the user's active photo links, newest first. */
export const PhotoShareListResponse = z.object({ results: PhotoShareLink.array() });
export type PhotoShareListResponse = z.infer<typeof PhotoShareListResponse>;

/** What POST /photo/share does with a photo's link. */
export type PhotoShareAction = "enable" | "rotate" | "disable";

/**
 * What an anonymous visitor gets for /public/p/{slug}: PublicPhotoDetail without the image hash and
 * the hash-addressed thumbnail URLs. Media come as slug-scoped URLs, so revoking the link cuts them
 * off too. People come by name only.
 */
export const SharedPhoto = PublicPhotoDetail.omit({
  image_hash: true,
  square_thumbnail_url: true,
  big_thumbnail_url: true,
  small_square_thumbnail_url: true,
}).extend({
  thumbnail_url: z.string(),
  video_url: z.string().nullable(),
  // The canPlayType() string for a probed video (e.g. `video/mp4;
  // codecs="hvc1..."`); null for stills and unprobed videos. The public page
  // never transcodes, so it shows the fallback up front when this cannot play.
  video_playback_type: z.string().nullish(),
  people: z.array(z.object({ name: z.string() })).optional(),
});
export type SharedPhoto = z.infer<typeof SharedPhoto>;

/** GET /public/photo/{slug}/: the photo and the owner's settings that filtered it. */
export const SharedPhotoResponse = z.object({
  results: SharedPhoto,
  sharing_settings: PublicSharingSettings.optional(),
});
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
