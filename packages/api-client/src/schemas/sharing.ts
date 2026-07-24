import { z } from "zod";
import { PigPhoto, SimpleUser } from "./common";
import { UserAlbumInfo } from "./albums";

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
