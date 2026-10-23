import { z } from "zod";
import { IntegerId, PageFields, PigPhoto, SimpleUser } from "./common";

/*
 * The public gallery (#434): the public photos of every user who takes part, at the server's
 * address. Each photo shows what its owner's public sharing switches allow; lists never carry a
 * photo's coordinates or address, places are town names, and people are one entry per owner.
 */

/** GET /gallery/: who the gallery is open to and how much it shows; a 404 while it is closed. */
export const Gallery = z.object({
  stage: z.enum(["members", "everyone"]),
  indexable: z.boolean(),
  photo_count: z.number(),
  photographer_count: z.number(),
});
export type Gallery = z.infer<typeof Gallery>;

/** The id of the gallery timeline's group of photos without a date; a day's id is YYYYMMDD. */
export const GALLERY_UNDATED_DAY_ID = 1;

/** A day of the gallery's timeline, or (id 1, date null) its photos without a date, listed last. */
export const GalleryDay = z.object({
  id: z.number(),
  date: z.string().nullable(),
  // The town, when every photo of the day is of an owner who shares places; "" otherwise.
  location: z.string(),
  photo_count: z.number(),
});
export type GalleryDay = z.infer<typeof GalleryDay>;

/** GET /gallery/days/: the whole timeline index, unpaginated. */
export const GalleryDaysResponse = z.object({
  results: GalleryDay.array(),
});
export type GalleryDaysResponse = z.infer<typeof GalleryDaysResponse>;

/** GET /gallery/photos/?day=: one page of a day's photos. */
export const GalleryPhotosResponse = z.object({
  ...PageFields,
  results: PigPhoto.array(),
});
export type GalleryPhotosResponse = z.infer<typeof GalleryPhotosResponse>;

export const GalleryCover = z.object({
  image_hash: z.string(),
  video: z.boolean(),
});
export type GalleryCover = z.infer<typeof GalleryCover>;

/** A town of the photos of owners who share places, owners merged. */
export const GalleryPlace = z.object({
  name: z.string(),
  photo_count: z.number(),
  owner_ids: z.number().array(),
  cover_photos: GalleryCover.array(),
});
export type GalleryPlace = z.infer<typeof GalleryPlace>;

export const GalleryPlacesResponse = z.object({
  results: GalleryPlace.array(),
});
export type GalleryPlacesResponse = z.infer<typeof GalleryPlacesResponse>;

/** A person a photographer named: one entry per photographer and person, two "Mia"s stay two. */
export const GalleryPerson = z.object({
  id: IntegerId,
  name: z.string(),
  owner: SimpleUser,
  photo_count: z.number(),
  face_url: z.string().nullable(),
});
export type GalleryPerson = z.infer<typeof GalleryPerson>;

export const GalleryPeopleResponse = z.object({
  results: GalleryPerson.array(),
});
export type GalleryPeopleResponse = z.infer<typeof GalleryPeopleResponse>;

/** A user who takes part, with photos in the gallery. */
export const GalleryPhotographer = z.object({
  id: z.number(),
  username: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  photo_count: z.number(),
  cover_photos: GalleryCover.array(),
});
export type GalleryPhotographer = z.infer<typeof GalleryPhotographer>;

export const GalleryPhotographersResponse = z.object({
  results: GalleryPhotographer.array(),
});
export type GalleryPhotographersResponse = z.infer<typeof GalleryPhotographersResponse>;

/** GET /gallery/preview/ (admin): what the gallery shows once it is open, for the confirm. */
export const GalleryPreview = z.object({
  photo_count: z.number(),
  photographer_count: z.number(),
  photographers: GalleryPhotographer.array(),
});
export type GalleryPreview = z.infer<typeof GalleryPreview>;

/** The filters of the gallery's timeline: one photographer, a town, a person. */
export type GalleryFilter = {
  owner?: number;
  place?: string;
  person?: number;
};
