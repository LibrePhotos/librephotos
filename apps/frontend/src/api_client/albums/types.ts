import { z } from "zod";

import { PhotoSuperSimpleSchema } from "../../actions/albumActions.types";
import { DatePhotosGroupSchema, SimpleUserSchema } from "../../actions/photosActions.types";

const UserAlbumResponseSchema = z.object({
  id: z.number(),
  title: z.string(),
  cover_photo: PhotoSuperSimpleSchema,
  photo_count: z.number(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),
  created_on: z.string(),
  favorited: z.boolean(),
});

const UserAlbumListSchema = UserAlbumResponseSchema.array();

export const UserAlbumListResponseSchema = z.object({
  results: UserAlbumListSchema,
});

export type UserAlbumList = z.infer<typeof UserAlbumListSchema>;

export const UserAlbumSchema = z.object({
  id: z.string(),
  title: z.string(),
  owner: SimpleUserSchema,
  shared_to: SimpleUserSchema.array(),
  date: z.string(),
  location: z.string().nullable(),
  grouped_photos: DatePhotosGroupSchema.array(),
});

export type UserAlbum = z.infer<typeof UserAlbumSchema>;

export type DeleteUserAlbumParams = {
  id: string;
  albumTitle: string;
};

export type RenameUserAlbumParams = {
  id: string;
  title: string;
  newTitle: string;
};

export type CreateUserAlbumParams = {
  title: string;
  photos: string[];
};

export type RemovePhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

export type AddPhotoFromUserAlbumParams = {
  id: string;
  title: string;
  photos: string[];
};

export type SetUserAlbumCoverParams = {
  id: string;
  photo: string;
};
