import { z } from "zod";
import { DatePhotosGroup } from "./common";

export const Person = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  cover_photo: z.string().optional(),
});
export type Person = z.infer<typeof Person>;

export const PersonList = z.array(Person);
export type PersonList = z.infer<typeof PersonList>;

/** GET /api/persons/ (list view). */
export const FetchPeopleAlbumsResponse = z.object({
  results: Person.array(),
});
export type FetchPeopleAlbumsResponse = z.infer<typeof FetchPeopleAlbumsResponse>;

export const PersonAlbum = z.object({
  id: z.string(),
  name: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type PersonAlbum = z.infer<typeof PersonAlbum>;

export type RenamePersonAlbumParams = { id: number; name: string; newName: string };
export type DeletePersonAlbumParams = { id: number; name: string };
export type SetPersonAlbumCoverParams = { person_id: number; photo: string };
