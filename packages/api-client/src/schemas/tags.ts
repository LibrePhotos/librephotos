import { z } from "zod";
import { DatePhotosGroup, PhotoHash } from "./common";

export const Tag = z.object({
  id: z.number(),
  name: z.string(),
  photo_count: z.number(),
});
export type Tag = z.infer<typeof Tag>;

const TagListEntry = Tag.extend({
  cover_photos: PhotoHash.array(),
});

export const TagListResponse = z.object({
  results: TagListEntry.array(),
});
export type TagListResponse = z.infer<typeof TagListResponse>;

export const TagAlbum = z.object({
  id: z.number(),
  name: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type TagAlbum = z.infer<typeof TagAlbum>;

export const TagAlbumResponse = z.object({
  results: TagAlbum,
});
export type TagAlbumResponse = z.infer<typeof TagAlbumResponse>;

export type CreateTagParams = { name: string };
export type RenameTagParams = { id: number; name: string; newName: string };
export type DeleteTagParams = { id: number; name: string };
export type TagPhotosParams = { id: number; name: string; photos: string[] };
