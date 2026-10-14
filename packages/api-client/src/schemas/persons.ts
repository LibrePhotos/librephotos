import { z } from "zod";
import { DatePhotosGroup, IntegerId } from "./common";

export const Person = z.object({
  name: z.string(),
  face_url: z.string().nullable(),
  face_count: z.number(),
  face_photo_url: z.string().nullable(),
  video: z.boolean().optional(),
  id: z.number(),
  newPersonName: z.string().optional(),
  /** The ids of the owner's groups the person is in (#1126); servers before groups leave it out. */
  group_ids: z.number().array().optional(),
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
  id: IntegerId,
  name: z.string(),
  grouped_photos: DatePhotosGroup.array(),
});
export type PersonAlbum = z.infer<typeof PersonAlbum>;

export type RenamePersonAlbumParams = {
  id: number;
  name: string;
  newName: string;
};
/** `POST /persons/{id}/remove-photos/`: the person's faces on the photos went back to unknown. */
export const PersonRemovePhotosResponse = z.object({
  /** How many of the person's faces were unlabelled. */
  removed: z.number(),
  /** How many photos no longer show the person. */
  photo_count: z.number(),
  /** Why some face tags did not reach their files; the faces are unlabelled either way. */
  write_error: z.string().nullable(),
});
export type PersonRemovePhotosResponse = z.infer<typeof PersonRemovePhotosResponse>;

/** `POST /persons/{id}/merge/`: the other person's faces moved here and that person is gone. */
export const PersonMergeResponse = z.object({
  /** How many faces moved over. */
  moved: z.number(),
  /** How many photos now show this person instead. */
  photo_count: z.number(),
  /** Whether the face tags are being written to the files in the background. */
  write_queued: z.boolean(),
});
export type PersonMergeResponse = z.infer<typeof PersonMergeResponse>;

export type DeletePersonAlbumParams = { id: number; name: string };
export type SetPersonAlbumCoverParams = { person_id: number; photo: string };

/** One of the user's groups of people (#1126): `GET/POST /person-groups/`, `PATCH /person-groups/{id}/`. */
export const PersonGroup = z.object({
  id: z.number(),
  name: z.string(),
  /** How many people are in the group. */
  person_count: z.number(),
});
export type PersonGroup = z.infer<typeof PersonGroup>;

/** `GET /person-groups/`, every page read: the user's groups by name. */
export const PersonGroupList = z.object({
  results: PersonGroup.array(),
});
export type PersonGroupList = z.infer<typeof PersonGroupList>;

/** `PUT /persons/{id}/groups/`: the groups the person is in now. */
export const PersonGroupsResponse = z.object({
  group_ids: z.number().array(),
});
export type PersonGroupsResponse = z.infer<typeof PersonGroupsResponse>;
